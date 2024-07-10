// Импорт необходимых модулей
import axios from 'axios'
import { Markup, Telegraf, session } from 'telegraf'

// Токен бота
const token = '7415179094:AAHyPLljfNicW5Kn_owAqbwmOhz5tnyn7wA'
const bot = new Telegraf(token)

// Использование сессий для хранения состояния пользователя
bot.use(session())

// Хранение данных пользователей и кэш расписания
const users = new Map()
let scheduleCache = new Map()

// Функция для создания главного меню
const createMainMenu = (isAuthenticated, userName = '') => {
	const buttons = [
		['🌐 Наши соц. сети'],
		['🔔 Включить уведомления'],
		['ℹ️ Информация о боте'],
	]

	if (isAuthenticated) {
		buttons.unshift([`👤 ${userName}`, '📅 Расписание'])
	} else {
		buttons.unshift(['🔐 Войти'])
	}

	return Markup.keyboard(buttons).resize()
}

// Функция для создания меню расписания
const createScheduleMenu = Markup.keyboard([
	['Расписание на завтра'],
	['Расписание на текущую неделю'],
	['Календарь'],
	['Вернуться в главное меню'],
]).resize()

// Функция для удаления предыдущих сообщений
const deleteAllPreviousMessages = async ctx => {
	if (ctx.chat && ctx.message) {
		const currentMessageId = ctx.message.message_id
		for (let i = currentMessageId - 1; i > 0; i--) {
			try {
				await ctx.deleteMessage(i)
			} catch (error) {
				if (error.description !== 'Bad Request: message to delete not found') {
					console.error('Ошибка при удалении сообщения:', error)
				}
				break
			}
		}
	}
}

// Инициализация сессии
const initSession = (ctx, next) => {
	if (!ctx.session) {
		ctx.session = {}
	}
	return next()
}

bot.use(initSession)

// Middleware для проверки авторизации
const authMiddleware = (ctx, next) => {
	const userId = ctx.from.id
	if (users.has(userId)) {
		ctx.state.user = users.get(userId)
		return next()
	}
	ctx.reply('Пожалуйста, авторизуйтесь с помощью кнопки "🔐 Войти"')
}

// Функция для получения сокращенного имени
const getShortName = (lastName, firstName, parentName) => {
	return `${lastName} ${firstName[0]}.${parentName[0]}.`
}

// Функция для получения расписания с сервера
const fetchSchedule = async (token, week) => {
	try {
		const response = await axios.get(
			`https://iep.kgeu.ru/api/schedule${week ? `?week=${week}` : ''}`,
			{
				headers: { 'x-access-token': token },
			}
		)
		return response.data.payload
	} catch (error) {
		console.error('Ошибка при получении расписания:', error)
		return null
	}
}

// Функция для кэширования всех расписаний
const cacheAllSchedules = async token => {
	for (let week = 1; week <= 30; week++) {
		const schedule = await fetchSchedule(token, week)
		if (schedule && schedule.schedules.length > 0) {
			schedule.schedules.forEach(item => {
				const date = new Date(item.date).toISOString().split('T')[0]
				scheduleCache.set(date, item)
			})
		}
	}
}

// Функция форматирования даты
const formatDate = dateString => {
	const date = new Date(dateString)
	return date.toLocaleDateString('ru-RU', {
		day: '2-digit',
		month: '2-digit',
		year: 'numeric',
	})
}

// Функция получения дня недели
const getDayOfWeek = dateString => {
	const date = new Date(dateString)
	const days = [
		'воскресенье',
		'понедельник',
		'вторник',
		'среда',
		'четверг',
		'пятница',
		'суббота',
	]
	return days[date.getDay()]
}

// Функция форматирования сообщения с расписанием
const formatScheduleMessage = schedules => {
	if (schedules.length === 0) {
		return 'На этот день расписания нет.'
	}

	return schedules
		.map(item => {
			const date = formatDate(item.date)
			const dayOfWeek = getDayOfWeek(item.date)
			return `Дата: ${date} (${dayOfWeek})
Время: ${item.timeStart} - ${item.timeEnd}
Предмет: ${item.discip.name}
Тип: ${item.type.name}
Аудитория: ${item.auiditory}
Преподаватель: ${item.teacher.name}
-------------------`
		})
		.join('\n')
}

// Функция для создания календаря
const createCalendar = (year, month) => {
	const daysInMonth = new Date(year, month + 1, 0).getDate()
	const firstDayOfMonth = new Date(year, month, 1).getDay()

	let calendar = [['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс']]

	let week = new Array(7).fill('')
	for (let i = 1; i <= daysInMonth; i++) {
		const dayOfWeek = (firstDayOfMonth + i - 2) % 7
		week[dayOfWeek] = i.toString()

		if (dayOfWeek === 6 || i === daysInMonth) {
			calendar.push(week)
			week = new Array(7).fill('')
		}
	}

	return calendar
}

// Обработчик команды /start
bot.command('start', async ctx => {
	await deleteAllPreviousMessages(ctx)
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
	await ctx.reply('Добро пожаловать! Выберите действие:', mainMenu)
})

// Обработчик для просмотра профиля
bot.hears(/👤 .+/, authMiddleware, async ctx => {
	await deleteAllPreviousMessages(ctx)
	const userData = ctx.state.user.userData
	await ctx.reply(
		`Ваш профиль:
Имя: ${userData.FirstName}
Фамилия: ${userData.LastName}
Отчество: ${userData.ParentName}
Email: ${userData.EMail}
Должность: ${userData.Position}`,
		createMainMenu(
			true,
			getShortName(userData.LastName, userData.FirstName, userData.ParentName)
		)
	)
})

// Обработчик для входа в систему
bot.hears('🔐 Войти', async ctx => {
	await deleteAllPreviousMessages(ctx)
	await ctx.reply('Пожалуйста, введите ваш логин:')
	ctx.session.state = 'awaitingLogin'
})

// Обработчик для меню расписания
bot.hears('📅 Расписание', authMiddleware, async ctx => {
	await deleteAllPreviousMessages(ctx)
	await ctx.reply('Выберите опцию расписания:', createScheduleMenu)
})

// Обработчик для расписания на завтра
bot.hears('Расписание на завтра', authMiddleware, async ctx => {
	const token = ctx.state.user.token
	const tomorrow = new Date()
	tomorrow.setDate(tomorrow.getDate() + 1)
	const tomorrowStr = tomorrow.toISOString().split('T')[0]

	if (scheduleCache.size === 0) {
		await ctx.reply('Загрузка данных расписания...')
		await cacheAllSchedules(token)
	}

	const schedule = scheduleCache.get(tomorrowStr)
	if (schedule) {
		await ctx.reply(formatScheduleMessage([schedule]))
	} else {
		await ctx.reply('На завтра расписания нет.')
	}
})

// Обработчик для расписания на текущую неделю
bot.hears('Расписание на текущую неделю', authMiddleware, async ctx => {
	const token = ctx.state.user.token
	const schedule = await fetchSchedule(token)
	if (schedule) {
		await ctx.reply(formatScheduleMessage(schedule.schedules))
	} else {
		await ctx.reply('Не удалось получить расписание на текущую неделю.')
	}
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

	keyboard.push([
		Markup.button.callback('Вернуться в меню расписания', 'back_to_schedule'),
	])

	await ctx.reply(
		'Выберите интересующую дату:',
		Markup.inlineKeyboard(keyboard)
	)
})

// Обработчик для возврата в главное меню
bot.hears('Вернуться в главное меню', async ctx => {
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
	await ctx.reply('Главное меню:', mainMenu)
})

// Обработчик для просмотра социальных сетей
bot.hears('🌐 Наши соц. сети', async ctx => {
	await deleteAllPreviousMessages(ctx)
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
	await ctx.reply('Наши социальные сети:', mainMenu)
})

// Обработчик для включения уведомлений
bot.hears('🔔 Включить уведомления', async ctx => {
	await deleteAllPreviousMessages(ctx)
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
	await ctx.reply('Уведомления включены', mainMenu)
})

// Обработчик для просмотра информации о боте
bot.hears('ℹ️ Информация о боте', async ctx => {
	await deleteAllPreviousMessages(ctx)
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
	await ctx.reply(
		'Этот бот предназначен для получения информации о расписании КГЭУ.',
		mainMenu
	)
})

// Обработчик для callback-запросов (для работы с календарем)
bot.on('callback_query', async ctx => {
	const callbackData = ctx.callbackQuery.data

	if (callbackData === 'noop') {
		return await ctx.answerCbQuery()
	}

	if (callbackData === 'back_to_schedule') {
		await ctx.answerCbQuery()
		return await ctx.editMessageText(
			'Выберите опцию расписания:',
			createScheduleMenu
		)
	}

	if (callbackData.startsWith('date:')) {
		const [year, month, day] = callbackData.split(':')[1].split('-').map(Number)
		const date = new Date(year, month - 1, day)
		const formattedDate = date.toISOString().split('T')[0]

		const schedule = scheduleCache.get(formattedDate)
		if (schedule) {
			await ctx.answerCbQuery()
			await ctx.editMessageText(formatScheduleMessage([schedule]))
		} else {
			await ctx.answerCbQuery('На выбранную дату расписания нет.')
		}
		return
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

		keyboard.push([
			Markup.button.callback('Вернуться в меню расписания', 'back_to_schedule'),
		])

		await ctx.answerCbQuery()
		await ctx.editMessageText(
			'Выберите интересующую дату:',
			Markup.inlineKeyboard(keyboard)
		)
	}
})

// Обработчик текстовых сообщений
bot.on('text', async ctx => {
	await deleteAllPreviousMessages(ctx)

	const userId = ctx.from.id

	switch (ctx.session.state) {
		case 'awaitingLogin':
			ctx.session.login = ctx.message.text
			await ctx.reply('Теперь введите ваш пароль:')
			ctx.session.state = 'awaitingPassword'
			break
		case 'awaitingPassword':
			const { login } = ctx.session
			const password = ctx.message.text

			try {
				const response = await axios.get(`https://iep.kgeu.ru/api/auth`, {
					params: { login, password },
				})

				if (response.data.type === 'success') {
					const { token, userData } = response.data.payload
					users.set(userId, { login, token, userData })
					const shortName = getShortName(
						userData.LastName,
						userData.FirstName,
						userData.ParentName
					)
					await ctx.reply(
						`Здравствуйте, ${userData.LastName} ${userData.FirstName} ${userData.ParentName}! Вы успешно авторизованы.`,
						createMainMenu(true, shortName)
					)
					await cacheAllSchedules(token)
				} else {
					await ctx.reply(
						'Ошибка авторизации. Пожалуйста, попробуйте еще раз.',
						createMainMenu(false)
					)
				}
			} catch (error) {
				console.error('Ошибка при авторизации:', error)
				await ctx.reply(
					'Произошла ошибка при авторизации. Введите правильные данные',
					createMainMenu(false)
				)
			}

			delete ctx.session.state
			delete ctx.session.login
			break
		case 'awaitingDate':
			const dateInput = ctx.message.text
			const [day, month, year] = dateInput.split('.').map(Number)
			const date = new Date(year, month - 1, day)
			if (!isNaN(date.getTime())) {
				const formattedDate = date.toISOString().split('T')[0]
				const schedule = scheduleCache.get(formattedDate)
				if (schedule) {
					await ctx.reply(formatScheduleMessage([schedule]))
				} else {
					await ctx.reply('На выбранную дату расписания нет.')
				}
			} else {
				await ctx.reply(
					'Неверный формат даты. Пожалуйста, введите дату в формате ДД.ММ.ГГГГ.'
				)
			}
			delete ctx.session.state
			break
		default:
			await ctx.reply(
				'Пожалуйста, используйте меню для взаимодействия с ботом.',
				createMainMenu(
					users.has(userId),
					users.has(userId)
						? getShortName(
								users.get(userId).userData.LastName,
								users.get(userId).userData.FirstName,
								users.get(userId).userData.ParentName
						  )
						: ''
				)
			)
	}
})

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
	ctx.reply(
		'Произошла ошибка при обработке вашего запроса. Пожалуйста, попробуйте позже.',
		mainMenu
	)
})

// Запуск бота
bot.launch()

// Корректное завершение работы бота
process.once('SIGINT', () => bot.stop('SIGINT'))
process.once('SIGTERM', () => bot.stop('SIGTERM'))
