
import { Markup, Telegraf, session } from 'telegraf'
import { token } from './config.js';
import { authMiddleware, initSession, createAuthenticatedMenu } from './userFunctions.js';
import { createMainMenu, createScheduleMenu, createSemesterKeyboard } from './menuFunctions.js';
import { getUser, saveUser, updateNotificationSettings, deleteUserData } from './database.js';
import { fetchBRS, fetchRecordBook, getAvailableSemesters } from './userFunctions.js';
import { getScheduleForDate, formatScheduleMessage, createCalendar, exportScheduleToCSV } from './scheduleFunctions.js';
import { formatDate, deleteAllPreviousMessages, getShortName } from './utils.js';
import axios from 'axios'
export const users = new Map();
const bot = new Telegraf(token);

bot.use(session());
bot.use(initSession);
export {bot}
let isStartCommandRunning = false
// Обработчик команды /start
bot.command('start', async ctx => {
	if (isStartCommandRunning) return
	isStartCommandRunning = true

	try {
		await deleteAllPreviousMessages(ctx)
		const mainMenu = await createAuthenticatedMenu(ctx)
		await ctx.reply(
			`Добро пожаловать!
			С помощью бота вы сможете:	
			📚 Смотреть информацию о ведомостях учёбы
			🗓️ Просматривать расписание занятий
			🔔 Получать уведомления о расписании
			Для этого вам нужно авторизоваться в системе с использованием логина и пароля от сайта https://e.kgeu.ru/
				
			Надеемся, что этот бот будет полезен для студентов в получении необходимой информации 🎓`,
			mainMenu
		)
	} finally {
		isStartCommandRunning = false
	}
})
// Обработчик для просмотра профиля
bot.hears(/👤 .+/, authMiddleware, async ctx => {
	await deleteAllPreviousMessages(ctx)
	const userData = ctx.state.user.userData
	await ctx.reply(
		`Ваш профиль:
${userData.LastName} ${userData.FirstName}  ${userData.ParentName}
Email: ${userData.EMail}
Роль: ${userData.Position}`,
		createMainMenu(
			true,
			getShortName(userData.LastName, userData.FirstName, userData.ParentName)
		)
	)
})

// Обработчик для входа в систему
bot.hears('🔐 Войти', async (ctx) => {
    await deleteAllPreviousMessages(ctx);
    await ctx.reply('Пожалуйста, введите ваш логин:');
    ctx.session.state = 'awaitingLogin';
});

// Обработчик для кнопки "Выйти"
bot.hears('🚪 Выйти с аккаунта', async ctx => {
    const userId = ctx.from.id
    await deleteUserData(userId)
    await ctx.reply('Вы успешно вышли из системы. Для повторного входа нажмите "🔐 Войти"', createMainMenu(false))
})


// Обработчик для меню расписания
bot.hears('📅 Расписание', authMiddleware, async (ctx) => {
    await deleteAllPreviousMessages(ctx);
    await ctx.reply('Выберите опцию расписания:', createScheduleMenu);
});
// Обработчик для расписания на завтра
bot.hears('На завтра', authMiddleware, async ctx => {
	const token = ctx.state.user.token
	const tomorrow = new Date()
	tomorrow.setDate(tomorrow.getDate() + 1)

	const schedules = await getScheduleForDate(token, tomorrow)
	if (schedules && schedules.length > 0) {
		await ctx.reply(formatScheduleMessage(schedules))
	} else {
		await ctx.reply('На завтра расписания нет.')
	}
})
// Обработчик для расписания на сегодня
bot.hears('На сегодня', authMiddleware, async ctx => {
	const token = ctx.state.user.token
	const today = new Date()

	const schedules = await getScheduleForDate(token, today)
	if (schedules && schedules.length > 0) {
		await ctx.reply(formatScheduleMessage(schedules))
	} else {
		await ctx.reply('На сегодня расписания нет.')
	}
})

// Обработчик для расписания на текущую неделю
bot.hears('На текущую неделю', authMiddleware, async ctx => {
	const token = ctx.state.user.token
	const today = new Date()
	const weekStart = new Date(
		today.setDate(today.getDate() - today.getDay() + 1)
	)
	const weekEnd = new Date(today.setDate(today.getDate() - today.getDay() + 7))

	let weekSchedule = []
	for (let d = weekStart; d <= weekEnd; d.setDate(d.getDate() + 1)) {
		const daySchedule = await getScheduleForDate(token, new Date(d))
		if (daySchedule) {
			weekSchedule = weekSchedule.concat(daySchedule)
		}
	}

	if (weekSchedule.length > 0) {
		await ctx.reply(formatScheduleMessage(weekSchedule))
	} else {
		await ctx.reply('На текущую неделю расписания нет.')
	}
})
// Обработчик для балов БРС
bot.hears('📊 Баллы БРС', authMiddleware, async ctx => {
	await ctx.reply(
		'Выберите опцию:',
		Markup.keyboard([
			['Баллы текущего семестра'],
			['Выбрать семестр БРС'],
			['Вернуться в главное меню'],
		]).resize()
	)
})

// Обработчик для выбора семестра (как для БРС, так и для зачетной книжки)
bot.hears(/^Семестр \d+$/, authMiddleware, async ctx => {
	const semester = parseInt(ctx.match[0].split(' ')[1])
	const userId = ctx.from.id
	const user = await getUser(userId)

	if (!user || !user.token) {
		await ctx.reply('Пожалуйста, авторизуйтесь снова.')
		return
	}

	if (ctx.session.state === 'awaitingBRSSemester') {
		const brsData = await fetchBRS(user.token, semester)
		if (brsData) {
			let message = `Баллы БРС за ${semester} семестр:\n\n`
			brsData.brs.forEach(subject => {
				const totalPoints =
					subject.points.reduce((sum, point) => sum + point.point, 0) +
					subject.addPoints.reduce((sum, point) => sum + point, 0)
				message += `${subject.discip}: ${totalPoints} баллов\n`
			})
			await ctx.reply(message)
		} else {
			await ctx.reply('Не удалось получить данные БРС для выбранного семестра.')
		}
	} else if (ctx.session.state === 'awaitingRecordSemester') {
		const recordData = await fetchRecordBook(user.token, semester)
		if (recordData) {
			let message = `Зачетная книжка за ${semester} семестр:\n\n`
			recordData.record.forEach(subject => {
				message += `${subject.discip}: ${subject.mark} баллов, ${subject.result}\n`
			})
			await ctx.reply(message)
		} else {
			await ctx.reply(
				'Не удалось получить данные зачетной книжки для выбранного семестра.'
			)
		}
	}

	// Сбрасываем состояние сессии
	delete ctx.session.state

	// Возвращаемся в главное меню
	const mainMenu = await createAuthenticatedMenu(ctx)
	await ctx.reply('Вернуться в главное меню:', mainMenu)
})

// Обработчик для зачетной книжки
bot.hears('📚 Зачетная книжка', authMiddleware, async ctx => {
	await ctx.reply(
		'Выберите опцию:',
		Markup.keyboard([
			['Зачетная книжка текущего семестра'],
			['Выбрать семестр зачетной книжки'],
			['Вернуться в главное меню'],
		]).resize()
	)
})

//Обработчик для отображения балов текущего семестра
bot.hears('Баллы текущего семестра', authMiddleware, async ctx => {
	const userId = ctx.from.id
	const user = await getUser(userId)
	if (!user || !user.token) {
		await ctx.reply('Пожалуйста, авторизуйтесь снова.')
		return
	}
	const brsData = await fetchBRS(user.token)
	if (brsData) {
		let message = 'Баллы текущего семестра:\n\n'
		brsData.brs.forEach(subject => {
			const totalPoints =
				subject.points.reduce((sum, point) => sum + point.point, 0) +
				subject.addPoints.reduce((sum, point) => sum + point, 0)
			message += `${subject.discip}: ${totalPoints} баллов\n`
		})
		await ctx.reply(message)
	} else {
		await ctx.reply('Не удалось получить данные БРС.')
	}
})

//Обработчик для отображения ведомостей текущего семестра
bot.hears('Зачетная книжка текущего семестра', authMiddleware, async ctx => {
	const userId = ctx.from.id
	const user = await getUser(userId)
	if (!user || !user.token) {
		await ctx.reply('Пожалуйста, авторизуйтесь снова.')
		return
	}
	const recordData = await fetchRecordBook(user.token)
	if (recordData) {
		let message = `Зачетная книжка (семестр ${recordData.semestr}):\n\n`
		recordData.record.forEach(subject => {
			message += `${subject.discip}: ${subject.mark} баллов, ${subject.result}\n`
		})
		await ctx.reply(message)
	} else {
		await ctx.reply('Не удалось получить данные зачетной книжки.')
	}
})

//Обработчики для выбора семестра БРС
bot.hears('Выбрать семестр БРС', authMiddleware, async ctx => {
	const userId = ctx.from.id
	const user = await getUser(userId)
	if (!user || !user.token) {
		await ctx.reply('Пожалуйста, авторизуйтесь снова.')
		return
	}
	const semesters = await getAvailableSemesters(user.token)
	await ctx.reply('Выберите семестр:', createSemesterKeyboard(semesters))
	ctx.session.state = 'awaitingBRSSemester'
})

//Обработчик для выбора семестра зачетной книжки
bot.hears('Выбрать семестр зачетной книжки', authMiddleware, async ctx => {
	const userId = ctx.from.id
	const user = await getUser(userId)
	if (!user || !user.token) {
		await ctx.reply('Пожалуйста, авторизуйтесь снова.')
		return
	}
	const semesters = await getAvailableSemesters(user.token)
	await ctx.reply('Выберите семестр:', createSemesterKeyboard(semesters))
	ctx.session.state = 'awaitingRecordSemester'
})

// Обработчик для календаря
bot.hears('Календарь', authMiddleware, async ctx => {
	const now = new Date()
	const year = now.getFullYear()
	const month = now.getMonth()
	const calendar = createCalendar(year, month)

	const monthNames = [
		'Январь',
		'Февраль',
		'Март',
		'Апрель',
		'Май',
		'Июнь',
		'Июль',
		'Август',
		'Сентябрь',
		'Октябрь',
		'Ноябрь',
		'Декабрь',
	]

	const keyboard = calendar.map(week =>
		week.map(day =>
			day
				? Markup.button.callback(day, `date:${year}-${month + 1}-${day}`)
				: Markup.button.callback(' ', 'noop')
		)
	)

	keyboard.unshift([
		Markup.button.callback('<<', `month:${year}-${month - 1}`),
		Markup.button.callback(monthNames[month], 'noop'),
		Markup.button.callback('>>', `month:${year}-${month + 1}`),
	])

	await ctx.reply(
		'Выберите интересующую дату:',
		Markup.inlineKeyboard(keyboard)
	)
})

// Обработчик для возврата в главное меню
bot.hears('Вернуться в главное меню', async ctx => {
	const mainMenu = await createAuthenticatedMenu(ctx)
	await ctx.reply('Главное меню:', mainMenu)
})

// Обработчик для просмотра социальных сетей
bot.hears('🌐 Наши соц. сети', async ctx => {
	await deleteAllPreviousMessages(ctx)
	const mainMenu = await createAuthenticatedMenu(ctx)
	await ctx.reply(
		`Официальный сайт КГЭУ: https://www.kgeu.ru/ 🌐
        Образовательная платформа КГЭУ: https://e.kgeu.ru/ 🌐
        Разработчик бота:
        ВКонтакте: https://vk.com/plaginnnn 🌐
        Telegram: @Plaginnnnn 🌐
`,
		mainMenu
	)
})

// Обработчик для включения уведомлений
bot.hears('🔔 Включить уведомления', async ctx => {
	const userId = ctx.from.id
	const user = await getUser(userId)
	if (user) {
		const newNotificationStatus = !user.notificationsEnabled
		await updateNotificationSettings(userId, newNotificationStatus)
		await saveUser(
			userId,
			user.login,
			user.token,
			user.userData,
			newNotificationStatus
		)
		const mainMenu = await createAuthenticatedMenu(ctx)
		await ctx.reply(
			newNotificationStatus
				? 'Уведомления включены. Вы будете получать расписание на следующий день каждый вечер в 18:00.'
				: 'Уведомления выключены',
			mainMenu
		)
	} else {
		await ctx.reply('Пожалуйста, авторизуйтесь для управления уведомлениями.')
	}
})

// Обработчик для просмотра информации о боте
bot.hears('ℹ️ Информация о боте', async ctx => {
	await deleteAllPreviousMessages(ctx)
	const mainMenu = await createAuthenticatedMenu(ctx)
	await ctx.reply(
		`Обнаружили баг или неверные данные? Свяжитесь с разработчиком бота!  @Plaginnnnn 🌐

🔒 Бот использует безопасное хранение данных, привязанных к идентификаторам пользователей в Telegram.

🎓 Надеемся, что бот окажется полезным инструментом для студентов, предоставляя доступ к расписанию и успеваемости.`,
		mainMenu
	)
})
// Обработчик для callback-запросов (для работы с календарем)
bot.on('callback_query', async ctx => {
    const userId = ctx.from.id;

    // Проверка авторизации через базу данных
    const user = await getUser(userId);
    if (!user || !user.token) {
        await ctx.answerCbQuery('Пожалуйста, авторизуйтесь для доступа к этой функции.');
        return;
    }

    const token = user.token;
    const callbackData = ctx.callbackQuery.data;

    if (callbackData === 'noop') {
        return await ctx.answerCbQuery();
    }

    if (callbackData === 'back_to_schedule') {
        await ctx.answerCbQuery();
        return await ctx.editMessageText('Выберите опцию расписания:', createScheduleMenu);
    }

    if (callbackData.startsWith('date:')) {
        const [year, month, day] = callbackData.split(':')[1].split('-').map(Number);
        const selectedDate = new Date(year, month - 1, day);
        
        const schedules = await getScheduleForDate(token, selectedDate);

        if (schedules && schedules.length > 0) {
            await ctx.answerCbQuery();
            
            const message = `Расписание на ${formatDate(selectedDate)}:\n\n${formatScheduleMessage(schedules)}`;

            await ctx.editMessageText(message, {
                reply_markup: {
                    inline_keyboard: [
                        [
                            {
                                text: 'Вернуться к календарю',
                                callback_data: `month:${year}-${month - 1}`,
                            },
                        ],
                    ],
                },
            });
        } else {
            await ctx.answerCbQuery(`На выбранную дату (${formatDate(selectedDate)}) расписания нет.`);
        }
    }

	if (callbackData.startsWith('month:')) {
		const [year, month] = callbackData.split(':')[1].split('-').map(Number)
		const calendar = createCalendar(year, month)
		const monthNames = [
			'Январь',
			'Февраль',
			'Март',
			'Апрель',
			'Май',
			'Июнь',
			'Июль',
			'Август',
			'Сентябрь',
			'Октябрь',
			'Ноябрь',
			'Декабрь',
		]

		const keyboard = calendar.map(week =>
			week.map(day =>
				day
					? Markup.button.callback(day, `date:${year}-${month + 1}-${day}`)
					: Markup.button.callback(' ', 'noop')
			)
		)

		keyboard.unshift([
			Markup.button.callback('<<', `month:${year}-${month - 1}`),
			Markup.button.callback(monthNames[month], 'noop'),
			Markup.button.callback('>>', `month:${year}-${month + 1}`),
		])

		await ctx.answerCbQuery()
		await ctx.editMessageText(
			'Выберите интересующую дату:',
			Markup.inlineKeyboard(keyboard)
		)
	}
})
//Обработчик для экспорта расписания для гугл календаря
bot.hears('Export Google Calendar', authMiddleware, async ctx => {
	const token = ctx.state.user.token
	const csvBuffer = await exportScheduleToCSV(token)

	await ctx.replyWithDocument(
		{ source: csvBuffer, filename: 'schedule.csv' },
		{ caption: 'Вот ваше расписание в формате CSV для Google Calendar.' }
	)
})
// Обработчик текстовых сообщений
bot.on('text', async ctx => {
    await deleteAllPreviousMessages(ctx);

    const userId = ctx.from.id;

    switch (ctx.session.state) {
        case 'awaitingLogin':
            ctx.session.login = ctx.message.text;
            await ctx.reply('Теперь введите ваш пароль:');
            await deleteAllPreviousMessages(ctx);
            ctx.session.state = 'awaitingPassword';
            break;
        case 'awaitingPassword':
            const { login } = ctx.session;
            const password = ctx.message.text;
            await ctx.deleteMessage();

            const processingMsg = await ctx.reply('Проверка учетных данных...');
            try {
                const response = await axios.get(`https://iep.kgeu.ru/api/auth`, {
                    params: { login, password },
                });

                if (response.data.type === 'success') {
                    const { token, userData } = response.data.payload;
                    await saveUser(userId, login, token, userData, false, password);
                    users.set(userId, { token, userData, login, password }); // Обновление Map в памяти
                    const shortName = getShortName(
                        userData.LastName,
                        userData.FirstName,
                        userData.ParentName
                    );
                    await ctx.deleteMessage(processingMsg.message_id);
                    await ctx.reply(
                        `Добро пожаловать, ${userData.LastName} ${userData.FirstName} ${userData.ParentName}! Вы успешно вошли в систему.`,
                        createMainMenu(true, shortName)
                    );
                } else {
                    await ctx.deleteMessage(processingMsg.message_id);
                    await ctx.reply(
                        'Ошибка аутентификации. Пожалуйста, попробуйте снова.',
                        createMainMenu(false)
                    );
                }
            } catch (error) {
                console.error('Ошибка во время аутентификации:', error);
                await ctx.deleteMessage(processingMsg.message_id);
                await ctx.reply(
                    'Произошла ошибка во время аутентификации. Пожалуйста, введите правильные учетные данные.',
                    createMainMenu(false)
                );
            }

            delete ctx.session.state;
            delete ctx.session.login;
            break;
        default:
            const user = await getUser(userId);
            await ctx.reply(
                'Пожалуйста, используйте меню для взаимодействия с ботом.',
                createMainMenu(
                    !!user,
                    user
                        ? getShortName(
                            user.userData.LastName,
                            user.userData.FirstName,
                            user.userData.ParentName
                        )
                        : ''
                )
            );
    }
});

// Обработчик ошибок
bot.catch((err, ctx) => {
	console.error(`Ошибка для ${ctx.updateType}`, err)
	const userId = ctx.from.id
	const isAuthenticated = users.has(userId)
	const mainMenu = createMainMenu(
		isAuthenticated,
		isAuthenticated
			? getShortName(
					users.get(userId).userData.LastName,
					users.get(userId).userData.FirstName,
					users.get(userId).userData.ParentName
			  )
			: ''
	)
})


