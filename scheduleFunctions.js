import axios from 'axios'
import {SCHEDULE_START_DATE,FIRST_WEEK_NUMBER} from './config.js'
import {formatDate} from './utils.js'

// Функция для получения расписания с сервера
export const fetchSchedule = async (token, week) => {
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
export const fetchScheduleForWeek = async (token, week) => {
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

// Функция для получения расписания на конкретную дату
export const getScheduleForDate = async (token, date) => {
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

// Функция форматирования сообщения с расписанием
export const formatScheduleMessage = schedules => {
	if (schedules.length === 0) {
		return 'На этуs неделю расписания нет.'
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
export const createCalendar = (year, month) => {
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

// Функция для получения номера недели по дате
export const getWeekNumber = date => {
	const diff = date.getTime() - SCHEDULE_START_DATE.getTime()
	const oneWeek = 7 * 24 * 60 * 60 * 1000
	return Math.floor(diff / oneWeek) + FIRST_WEEK_NUMBER
}

// Функция получения дня недели
export const getDayOfWeek = dateString => {
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

//Функция для отправки ежедневных уведомлений
export const sendDailyNotification = async () => {
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

//Экспорт расписания в формате CSV
export const exportScheduleToCSV = async token => {
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

