import dotenv from 'dotenv';
import { bot } from './bot.js';
import { pool } from './database.js';
import schedule from 'node-schedule';
import { sendDailyNotification } from './scheduleFunctions.js';
// Хранение данных пользователей и кэш расписания
export const users = new Map();


dotenv.config();
// Запуск бота
bot.launch().then(() => {
    console.log('Бот запущен');
}).catch((error) => {
    console.error('Ошибка при запуске бота:', error);
});

// Ежедневные уведомления
schedule.scheduleJob('0 18 * * *', sendDailyNotification);

// Корректное завершение работы бота
process.once('SIGINT', () => {
    bot.stop('SIGINT');
    pool.end();
});
process.once('SIGTERM', () => {
    bot.stop('SIGTERM');
    pool.end();
});