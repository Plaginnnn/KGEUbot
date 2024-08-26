import axios from 'axios'
import { config } from 'dotenv'
import schedule from 'node-schedule'
import pkg from 'pg'
const { Pool } = pkg

import { Markup, Telegraf, session } from 'telegraf'

config() // Загружаем переменные из .env

const pool = new Pool({
	user: process.env.DB_USER,
	host: process.env.DB_HOST,
	database: process.env.DB_NAME,
	password: process.env.DB_PASSWORD,
	port: process.env.DB_PORT,
})

const token = process.env.TELEGRAM_BOT_TOKEN
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
	['Расписание на сегодня', 'Расписание на завтра'],
	['Расписание на текущую неделю', 'Выбрать по дате'],
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
// Функция для сохранения пользователя в базе данных
async function saveUser(userId, login, token, userData, notificationsEnabled) {
	const client = await pool.connect()
	try {
		await client.query(
			'INSERT INTO users (user_id, login, token, last_name, first_name, parent_name, email, position, notifications_enabled) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) ON CONFLICT (user_id) DO UPDATE SET login = $2, token = $3, last_name = $4, first_name = $5, parent_name = $6, email = $7, position = $8, notifications_enabled = $9',
			[
				userId,
				login,
				token,
				userData.LastName,
				userData.FirstName,
				userData.ParentName,
				userData.EMail,
				userData.Position,
				notificationsEnabled,
			]
		)
	} finally {
		client.release()
	}
}
//Функция для для проверки авторизации и создании меню
async function createAuthenticatedMenu(ctx) {
	const userId = ctx.from.id
	const user = await getUser(userId)
	const isAuthenticated = !!user
	return createMainMenu(
		isAuthenticated,
		isAuthenticated
			? getShortName(
					user.userData.LastName,
					user.userData.FirstName,
					user.userData.ParentName
			  )
			: ''
	)
}

// Функция для получения пользователя из базы данных
async function getUser(userId) {
	const client = await pool.connect()
	try {
		const result = await client.query(
			'SELECT * FROM users WHERE user_id = $1',
			[userId]
		)
		if (result.rows.length > 0) {
			const user = result.rows[0]
			return {
				login: user.login,
				token: user.token,
				userData: {
					LastName: user.last_name,
					FirstName: user.first_name,
					ParentName: user.parent_name,
					EMail: user.email,
					Position: user.position,
				},
				notificationsEnabled: user.notifications_enabled,
			}
		}
		return null
	} finally {
		client.release()
	}
}

// Функция для проверки валидности токена
async function checkToken(token) {
	try {
		const response = await axios.get('https://iep.kgeu.ru/api/user', {
			headers: { 'x-access-token': token },
		})
		return response.data.type === 'success'
	} catch (error) {
		console.error('Ошибка при проверке токена:', error)
		return false
	}
}
// Функция для обновления токена
async function refreshToken(userId, login, password) {
	try {
		const response = await axios.get('https://iep.kgeu.ru/api/auth', {
			params: { login, password },
		})
		if (response.data.type === 'success') {
			const { token, userData } = response.data.payload
			await saveUser(userId, login, token, userData, false)
			return token
		}
		return null
	} catch (error) {
		console.error('Ошибка при обновлении токена:', error)
		return null
	}
}

// Функция для обновления настроек уведомлений
async function updateNotificationSettings(userId, enabled) {
	const client = await pool.connect()
	try {
		await client.query(
			'UPDATE users SET notifications_enabled = $1 WHERE user_id = $2',
			[enabled, userId]
		)
	} finally {
		client.release()
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
const authMiddleware = async (ctx, next) => {
	const userId = ctx.from.id
	let user = await getUser(userId)
	if (user) {
		const isTokenValid = await checkToken(user.token)
		if (isTokenValid) {
			ctx.state.user = user
			return next()
		} else {
			// Если токен недействителен, пытаемся обновить его
			const newToken = await refreshToken(userId, user.login, user.password)
			if (newToken) {
				user.token = newToken
				await saveUser(
					userId,
					user.login,
					newToken,
					user.userData,
					user.notificationsEnabled
				)
				ctx.state.user = user
				return next()
			}
		}
	}
	const mainMenu = createMainMenu(false)
	await ctx.reply(
		'Пожалуйста, авторизуйтесь с помощью кнопки "🔐 Войти"',
		mainMenu
	)
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
    // Добавляем один день к выбранной дате
    const adjustedDate = new Date(date);
    adjustedDate.setDate(adjustedDate.getDate() + 1);

    const weekNumber = getWeekNumber(adjustedDate);
    const schedule = await fetchScheduleForWeek(token, weekNumber);
    if (!schedule) return null;

    // Преобразуем дату в строку в формате YYYY-MM-DD
    const dateString = adjustedDate.toISOString().split('T')[0];

    // Фильтруем расписание, сравнивая только даты без учета времени
    return schedule.filter(item => {
        const itemDate = new Date(item.date);
        const itemDateString = itemDate.toISOString().split('T')[0];
        return itemDateString === dateString;
    });
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
	const client = await pool.connect()
	try {
		const result = await client.query(
			'SELECT * FROM users WHERE notifications_enabled = true'
		)
		const tomorrow = new Date()
		tomorrow.setDate(tomorrow.getDate() + 1)

		for (const user of result.rows) {
			const schedules = await getScheduleForDate(user.token, tomorrow)
			if (schedules && schedules.length > 0) {
				await bot.telegram.sendMessage(
					user.user_id,
					`Расписание на завтра:\n\n${formatScheduleMessage(schedules)}`
				)
			} else {
				await bot.telegram.sendMessage(
					user.user_id,
					'На завтра расписания нет.'
				)
			}
		}
	} finally {
		client.release()
	}
}
schedule.scheduleJob('0 18 * * *', sendDailyNotification) // Отправка уведомлений пользователю в 18:00

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
		try {
			const date = new Date(item.date).toISOString().split('T')[0]
			csvContent += `"${item.discip.name} (${item.type.name})",${date},${item.timeStart},${date},${item.timeEnd},${item.auiditory},"${item.teacher.name}"\n`
		} catch (error) {
			console.error(`Ошибка при обработке элемента расписания:`, item, error)
		}
	})

	return Buffer.from(csvContent, 'utf8')
}
// Обработчик текстовых сообщений
bot.on('text', async ctx => {
	await deleteAllPreviousMessages(ctx)

	const userId = ctx.from.id

	switch (ctx.session.state) {
		case 'awaitingLogin':
			ctx.session.login = ctx.message.text
			await ctx.reply('Теперь введите ваш пароль:')
			await deleteAllPreviousMessages(ctx)
			ctx.session.state = 'awaitingPassword'
			break
		case 'awaitingPassword':
			const { login } = ctx.session
			const password = ctx.message.text
			await ctx.deleteMessage()

			const processingMsg = await ctx.reply('Проверка данных...')
			try {
				const response = await axios.get(`https://iep.kgeu.ru/api/auth`, {
					params: { login, password },
				})

				if (response.data.type === 'success') {
					const { token, userData } = response.data.payload
					await saveUser(userId, login, token, userData, false)
					users.set(userId, { token, userData, login, password }) // Обновляем Map в памяти
					const shortName = getShortName(
						userData.LastName,
						userData.FirstName,
						userData.ParentName
					)
					await ctx.deleteMessage(processingMsg.message_id)
					await ctx.reply(
						`Здравствуйте, ${userData.LastName} ${userData.FirstName} ${userData.ParentName}! Вы успешно авторизованы.`,
						createMainMenu(true, shortName)
					)
				} else {
					await ctx.deleteMessage(processingMsg.message_id)
					await ctx.reply(
						'Ошибка авторизации. Пожалуйста, попробуйте еще раз.',
						createMainMenu(false)
					)
				}
			} catch (error) {
				console.error('Ошибка при авторизации:', error)
				await ctx.deleteMessage(processingMsg.message_id)
				await ctx.reply(
					'Произошла ошибка при авторизации. Введите правильные данные',
					createMainMenu(false)
				)
			}

			delete ctx.session.state
			delete ctx.session.login
			break
		default:
			const user = await getUser(userId)
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
