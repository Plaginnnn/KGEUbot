// Импорт необходимых модулей
import axios from 'axios'
import schedule from 'node-schedule'
import { Markup, Telegraf, session } from 'telegraf'

// Токен бота
const token = '7415179094:AAHyPLljfNicW5Kn_owAqbwmOhz5tnyn7wA'
const bot = new Telegraf(token)

const FIRST_WEEK_NUMBER = 2 // Начало отсчета со второй недели
const SCHEDULE_START_DATE = new Date('2024-02-05')

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
		buttons.splice(1, 0, ['📊 Баллы БРС', '📚 Зачетная книжка'])
	} else {
		buttons.unshift(['🔐 Войти'])
	}

	return Markup.keyboard(buttons).resize()
}
// Функция для создания меню расписания
const createScheduleMenu = Markup.keyboard([
	['Расписание на сегодня'],
	['Расписание на завтра'],
	['Расписание на текущую неделю'],
	['Выбрать по дате'],
	['Export Google Calendar'],
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
// Функция для получения расписания на конкретную неделю
const fetchScheduleForWeek = async (token, week) => {
	try {
		const response = await axios.get(
			`https://iep.kgeu.ru/api/schedule?week=${week}`,
			{
				headers: { 'x-access-token': token },
			}
		)
		return response.data.payload.schedules
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
				if (!scheduleCache.has(date)) {
					scheduleCache.set(date, [])
				}
				scheduleCache.get(date).push(item)
			})
		}
	}
}
// Функция для получения расписания на конкретную дату
const getScheduleForDate = async (token, date) => {
	const weekNumber = getWeekNumber(date)
	const schedule = await fetchScheduleForWeek(token, weekNumber)
	if (!schedule) return null

	// Используем toISOString и split для получения даты в формате YYYY-MM-DD
	const dateString = date.toISOString().split('T')[0]
	return schedule.filter(item => item.date.startsWith(dateString))
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

// Функция для получения номера недели по дате
const getWeekNumber = date => {
	const diff = date.getTime() - SCHEDULE_START_DATE.getTime()
	const oneWeek = 7 * 24 * 60 * 60 * 1000
	return Math.floor(diff / oneWeek) + FIRST_WEEK_NUMBER
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
		return 'На эту неделю расписания нет.'
	}

	return schedules
		.map(item => {
			const date = formatDate(item.date)
			const dayOfWeek = getDayOfWeek(item.date)
			return `
			${date} (${dayOfWeek})
		${item.type.name}${item.discip.name}
 		${item.auiditory} / ${item.timeStart.slice(0, 5)} - ${item.timeEnd.slice(0, 5)}
 		${item.teacher.name}
---------------------------------------`
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

// Функция для получения данных БРС
const fetchBRS = async (token, semester = null) => {
	try {
		const url = semester
			? `https://iep.kgeu.ru/api/user/brs?semestr=${semester}`
			: 'https://iep.kgeu.ru/api/user/brs'
		const response = await axios.get(url, {
			headers: { 'x-access-token': token },
		})
		return response.data.payload
	} catch (error) {
		console.error('Ошибка при получении данных БРС:', error)
		return null
	}
}

// Функция для получения данных зачетной книжки
const fetchRecordBook = async (token, semester = null) => {
	try {
		const url = semester
			? `https://iep.kgeu.ru/api/user/record?semestr=${semester}`
			: 'https://iep.kgeu.ru/api/user/record'
		const response = await axios.get(url, {
			headers: { 'x-access-token': token },
		})
		return response.data.payload
	} catch (error) {
		console.error('Ошибка при получении данных зачетной книжки:', error)
		return null
	}
}
//Функция для определения количества семестров и создания клавиатуры выбора семестра
const getAvailableSemesters = async token => {
	let semesters = []
	for (let i = 1; ; i++) {
		const data = await fetchBRS(token, i)
		if (data && data.brs.length > 0) {
			semesters.push(i)
		} else {
			break
		}
	}
	return semesters
}

const createSemesterKeyboard = semesters => {
	const keyboard = semesters.map(semester => [`Семестр ${semester}`])
	keyboard.push(['Вернуться в главное меню'])
	return Markup.keyboard(keyboard).resize()
}

//Функция для отправки ежедневных уведомлений
const sendDailyNotification = async () => {
	const now = new Date()
	for (const [userId, user] of users.entries()) {
		if (user.notificationsEnabled) {
			const schedules = await getScheduleForDate(user.token, now)
			if (schedules && schedules.length > 0) {
				await bot.telegram.sendMessage(
					userId,
					`Расписание на сегодня:\n\n${formatScheduleMessage(schedules)}`
				)
			}
		}
	}
}

schedule.scheduleJob('0 6 * * *', sendDailyNotification) //Время для отправки уведомлений пользователю в 6 утра

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
	await ctx.reply(
		`
Добро пожаловать! Вас приветствует виртуальный помощник KGEUInfoBot.
С моей помощью Вы сможете:

📚 Смотреть информацию о ведомостях учёбы
🗓️ Просматривать расписание занятий
🔔 Получать уведомления о расписании
🔐 Авторизоваться в системе с использованием логина и пароля от сайта https://e.kgeu.ru/

Надеемся, что этот бот будет полезен для студентов в получении необходимой информации 🎓
`,
		mainMenu
	)
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

	const schedules = await getScheduleForDate(token, tomorrow)
	if (schedules && schedules.length > 0) {
		await ctx.reply(formatScheduleMessage(schedules))
	} else {
		await ctx.reply('На завтра расписания нет.')
	}
})

// Обработчик для расписания на сегодня
bot.hears('Расписание на сегодня', authMiddleware, async ctx => {
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
bot.hears('Расписание на текущую неделю', authMiddleware, async ctx => {
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
	const user = users.get(userId)
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
	const user = users.get(userId)
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

//Обработчики для выбора семестра
bot.hears('Выбрать семестр БРС', authMiddleware, async ctx => {
	const userId = ctx.from.id
	const user = users.get(userId)
	if (!user || !user.token) {
		await ctx.reply('Пожалуйста, авторизуйтесь снова.')
		return
	}
	const semesters = await getAvailableSemesters(user.token)
	await ctx.reply('Выберите семестр:', createSemesterKeyboard(semesters))
	ctx.session.state = 'awaitingBRSSemester'
})

bot.hears('Выбрать семестр зачетной книжки', authMiddleware, async ctx => {
	const userId = ctx.from.id
	const user = users.get(userId)
	if (!user || !user.token) {
		await ctx.reply('Пожалуйста, авторизуйтесь снова.')
		return
	}
	const semesters = await getAvailableSemesters(user.token)
	await ctx.reply('Выберите семестр:', createSemesterKeyboard(semesters))
	ctx.session.state = 'awaitingRecordSemester'
})

// Обработчик для календаря
bot.hears('Выбрать по дате', authMiddleware, async ctx => {
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
	await ctx.reply(
		`Официальный сайт КГЭУ: https://www.kgeu.ru/ 🌐
		Образовательная платформа КГЭУ: https://e.kgeu.ru/ 🌐
		ВКонтакте: https://vk.com/plaginnnn 🌐
		Telegram: @Plaginnnnn 🌐
`,
		mainMenu
	)
})

// Обработчик для включения уведомлений
bot.hears('🔔 Включить уведомления', async ctx => {
	const userId = ctx.from.id
	if (users.has(userId)) {
		const user = users.get(userId)
		user.notificationsEnabled = !user.notificationsEnabled
		users.set(userId, user)
		await ctx.reply(
			user.notificationsEnabled
				? 'Уведомления включены'
				: 'Уведомления выключены',
			createMainMenu(
				true,
				getShortName(
					user.userData.LastName,
					user.userData.FirstName,
					user.userData.ParentName
				)
			)
		)
	} else {
		await ctx.reply('Пожалуйста, авторизуйтесь для управления уведомлениями.')
	}
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
		`Информация о боте
Основные возможности бота:
Авторизация пользователей
Пользователи могут авторизоваться в боте, введя свой логин и пароль, такие же как на сайте https://e.kgeu.ru/ 🔐
После успешной авторизации, данные пользователя (имя, фамилия, отчество, email, должность) отображаются в профиле. 👤
Пользователи могут включать/выключать уведомления о важных событиях. 🔔
Бот использует безопасное хранение данных пользователей, привязанных к их идентификаторам в Telegram. Однако, на данный момент реализация постоянного хранения данных в базе данных еще не завершена, поэтому сессия пользователя может сбрасываться при перезапуске бота. 💾
Надеемся, что этот бот будет полезен для студентов и сотрудников КГЭУ в авторизации и получении доступа к информации об университете. 🎓
`,
		mainMenu
	)
})

// Обработчик для callback-запросов (для работы с календарем)
// Обработчик для callback-запросов (для работы с календарем)
bot.on('callback_query', async ctx => {
	const userId = ctx.from.id
	let token

	// Проверка авторизации
	if (users.has(userId)) {
		token = users.get(userId).token
	} else {
		await ctx.answerCbQuery(
			'Пожалуйста, авторизуйтесь для доступа к этой функции.'
		)
		return
	}

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

		const schedules = await getScheduleForDate(token, date)

		if (schedules && schedules.length > 0) {
			await ctx.answerCbQuery()
			await ctx.editMessageText(formatScheduleMessage(schedules), {
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
			})
		} else {
			await ctx.answerCbQuery('На выбранную дату расписания нет.')
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

const exportScheduleToCSV = async token => {
	let allSchedules = []
	for (let week = FIRST_WEEK_NUMBER; week <= 30; week++) {
		const weekSchedule = await fetchScheduleForWeek(token, week)
		if (weekSchedule) {
			allSchedules = allSchedules.concat(weekSchedule)
		}
	}

	let csvContent =
		'Subject,Start Date,Start Time,End Date,End Time,Location,Description\n'
	allSchedules.forEach(item => {
		const date = new Date(item.date).toISOString().split('T')[0]
		csvContent += `"${item.discip.name} (${item.type.name})",${date},${item.timeStart},${date},${item.timeEnd},${item.auiditory},"${item.teacher.name}"\n`
	})

	return Buffer.from(csvContent, 'utf8')
}

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
	await deleteAllPreviousMessages(ctx)

	const userId = ctx.from.id
	if (ctx.message.text.startsWith('Семестр ')) {
		const semester = parseInt(ctx.message.text.split(' ')[1])
		const userId = ctx.from.id
		const user = users.get(userId)

		if (!user || !user.token) {
			await ctx.reply('Пожалуйста, авторизуйтесь снова.')
			return
		}

		if (ctx.session.state === 'awaitingBRSSemester') {
			const brsData = await fetchBRS(user.token, semester)
			if (brsData && brsData.brs) {
				let message = `Баллы за ${semester} семестр:\n\n`
				brsData.brs.forEach(subject => {
					const totalPoints =
						subject.points.reduce((sum, point) => sum + point.point, 0) +
						subject.addPoints.reduce((sum, point) => sum + point, 0)
					message += `${subject.discip}: ${totalPoints} баллов\n`
				})
				await ctx.reply(message)
			} else {
				await ctx.reply(
					'Не удалось получить данные БРС для выбранного семестра.'
				)
			}
		} else if (ctx.session.state === 'awaitingRecordSemester') {
			const recordData = await fetchRecordBook(user.token, semester)
			if (recordData && recordData.record) {
				let message = `Зачетная книжка (семестр ${semester}):\n\n`
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

		// Возврат к главному меню после отображения данных
		const mainMenu = createMainMenu(
			true,
			getShortName(
				user.userData.LastName,
				user.userData.FirstName,
				user.userData.ParentName
			)
		)
		await ctx.reply('Выберите дальнейшее действие:', mainMenu)

		delete ctx.session.state
		return
	}

	switch (ctx.session.state) {
		case 'awaitingLogin':
			ctx.session.login = ctx.message.text
			await ctx.reply('Теперь введите ваш пароль:')
			ctx.session.state = 'awaitingPassword'
			break
		case 'awaitingBRSSemester':
			if (ctx.message.text.startsWith('Семестр ')) {
				const semester = parseInt(ctx.message.text.split(' ')[1])
				const brsData = await fetchBRS(ctx.state.user.token, semester)
				if (brsData) {
					let message = `Баллы за ${semester} семестр:\n\n`
					brsData.brs.forEach(subject => {
						const totalPoints =
							subject.points.reduce((sum, point) => sum + point.point, 0) +
							subject.addPoints.reduce((sum, point) => sum + point, 0)
						message += `${subject.discip}: ${totalPoints} баллов\n`
					})
					await ctx.reply(message)
				} else {
					await ctx.reply(
						'Не удалось получить данные БРС для выбранного семестра.'
					)
				}
			}
			delete ctx.session.state
			break

		case 'awaitingRecordSemester':
			if (ctx.message.text.startsWith('Семестр ')) {
				const semester = parseInt(ctx.message.text.split(' ')[1])
				const recordData = await fetchRecordBook(ctx.state.user.token, semester)
				if (recordData) {
					let message = `Зачетная книжка (семестр ${semester}):\n\n`
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
			delete ctx.session.state
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
					users.set(userId, {
						login,
						token,
						userData,
						notificationsEnabled: false,
					})
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
})

// Запуск бота
bot.launch()

// Корректное завершение работы бота
process.once('SIGINT', () => bot.stop('SIGINT'))
process.once('SIGTERM', () => bot.stop('SIGTERM'))
