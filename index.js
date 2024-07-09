// Импорт необходимых библиотек
import axios from 'axios'
import { session, Telegraf } from 'telegraf'

// Токен бота Telegram
const token = '7415179094:AAHyPLljfNicW5Kn_owAqbwmOhz5tnyn7wA'
// Создание экземпляра бота
const bot = new Telegraf(token)

// Использование встроенного middleware для сессий
bot.use(session())

// Хранилище данных пользователей
// Используется Map для хранения информации о пользователях
const users = new Map()

/**
 * Middleware для проверки авторизации пользователя
 * @param {Object} ctx - Контекст Telegraf
 * @param {Function} next - Функция для перехода к следующему обработчику
 */
const authMiddleware = (ctx, next) => {
	const userId = ctx.from.id
	console.log(`Проверка авторизации для пользователя ${userId}`)
	console.log('Текущие пользователи:', Array.from(users.entries()))
	if (users.has(userId)) {
		console.log(`Пользователь ${userId} авторизован`)
		ctx.state.user = users.get(userId)
		return next()
	}
	console.log(`Пользователь ${userId} не авторизован`)
	ctx.reply('Пожалуйста, авторизуйтесь с помощью команды /login')
}

// Команда для начала работы с ботом
bot.command('start', ctx => {
	ctx.reply(
		'Добро пожаловать! Для начала работы, пожалуйста, авторизуйтесь с помощью команды /login'
	)
})

/**
 * Команда для просмотра профиля (требует авторизации)
 * Отображает информацию о пользователе, если он авторизован
 */
bot.command('profile', async ctx => {
	const userId = ctx.from.id
	console.log(`Получена команда /profile от пользователя ${userId}`)

	if (users.has(userId)) {
		const userData = users.get(userId).userData
		console.log('Данные пользователя:', userData)
		ctx.reply(`Ваш профиль:
Имя: ${userData.FirstName}
Фамилия: ${userData.LastName}
Отчество: ${userData.ParentName}
Email: ${userData.EMail}
Должность: ${userData.Position}`)
	} else {
		console.log(`Пользователь ${userId} не авторизован`)
		ctx.reply('Пожалуйста, авторизуйтесь с помощью команды /login')
	}
})

/**
 * Команда для выхода из аккаунта
 * Удаляет информацию о пользователе из хранилища
 */
bot.command('logout', ctx => {
	try {
		console.log('Выполняется команда logout')
		const userId = ctx.from.id
		if (users.has(userId)) {
			users.delete(userId)
			ctx.reply('Вы успешно вышли из аккаунта.')
			console.log(`Пользователь ${userId} вышел из аккаунта`)
		} else {
			ctx.reply('Вы не были авторизованы.')
			console.log(`Попытка выхода неавторизованного пользователя ${userId}`)
		}
	} catch (error) {
		console.error('Ошибка при выполнении команды logout:', error)
		ctx.reply(
			'Произошла ошибка при попытке выхода из аккаунта. Пожалуйста, попробуйте позже.'
		)
	}
})

/**
 * Команда для начала процесса авторизации
 * Устанавливает состояние сессии на ожидание ввода логина
 */
bot.command('login', ctx => {
	ctx.reply('Пожалуйста, введите ваш логин:')
	ctx.session = ctx.session || {}
	ctx.session.state = 'awaitingLogin'
})

/**
 * Обработчик текстовых сообщений
 * Управляет процессом авторизации, обрабатывая ввод логина и пароля
 */
bot.on('text', async ctx => {
	ctx.session = ctx.session || {}
	const userId = ctx.from.id

	if (ctx.session.state === 'awaitingLogin') {
		ctx.session.login = ctx.message.text
		ctx.reply('Теперь введите ваш пароль:')
		ctx.session.state = 'awaitingPassword'
	} else if (ctx.session.state === 'awaitingPassword') {
		const { login } = ctx.session
		const password = ctx.message.text

		try {
			// Отправка запроса на авторизацию
			const response = await axios.get(`https://iep.kgeu.ru/api/auth`, {
				params: { login, password },
			})

			if (response.data.type === 'success') {
				const { token, userData } = response.data.payload
				users.set(userId, { login, token, userData })
				console.log(`Пользователь ${userId} успешно авторизован`)
				console.log('Данные пользователя:', userData)

				ctx.reply(
					`Здравствуйте, ${userData.LastName} ${userData.FirstName} ${userData.ParentName}! Вы успешно авторизованы.`
				)
			} else {
				ctx.reply(
					'Ошибка авторизации. Пожалуйста, попробуйте еще раз с командой /login'
				)
			}
		} catch (error) {
			console.error('Ошибка при авторизации:', error)
			ctx.reply(
				'Произошла ошибка при авторизации. Пожалуйста, попробуйте позже.'
			)
		}

		// Очистка состояния сессии после завершения авторизации
		delete ctx.session.state
		delete ctx.session.login
	}
})

// Обработчик ошибок
bot.catch((err, ctx) => {
	console.error(`Ошибка для ${ctx.updateType}`, err)
	ctx.reply(
		'Произошла ошибка при обработке вашего запроса. Пожалуйста, попробуйте позже.'
	)
})

// Запуск бота
bot.launch()

// Включение graceful stop
// Обработка сигналов завершения для корректного завершения работы бота
process.once('SIGINT', () => bot.stop('SIGINT'))
process.once('SIGTERM', () => bot.stop('SIGTERM'))
