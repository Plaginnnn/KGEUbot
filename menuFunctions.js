import { Markup } from 'telegraf';
import { getUser } from './database.js';
import { getShortName } from './utils.js';
// Функция для создания главного меню
export const createMainMenu = (isAuthenticated, userName = '') => {
	const buttons = [
		['🌐 Наши соц. сети'],
		['ℹ️ Информация о боте'],
	]

	if (isAuthenticated) {
		buttons.unshift([`👤 ${userName}`, '📅 Расписание']);
		buttons.splice(1, 0, ['📊 Баллы БРС', '📚 Зачетная книжка']);
		buttons.splice(2, 0, ['🔔 Включить уведомления']); 
		buttons.push(['🚪 Выйти']) 
	} else {
		buttons.unshift(['🔐 Войти']);
	}

	return Markup.keyboard(buttons).resize();
}

 export const createScheduleMenu = Markup.keyboard([
    ['Расписание на сегодня', 'Расписание на завтра'],
    ['Расписание на текущую неделю', 'Выбрать по дате'],
    ['Export Google Calendar'],
    ['Вернуться в главное меню'],
]).resize();

export const createSemesterKeyboard = (semesters) => {
    const keyboard = semesters.map(semester => [`Семестр ${semester}`]);
    keyboard.push(['Вернуться в главное меню']);
    return Markup.keyboard(keyboard).resize();
};

