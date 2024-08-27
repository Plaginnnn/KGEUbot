import pg from 'pg';
import { dbConfig } from './config.js';

const { Pool } = pg;

export const pool = new Pool(dbConfig);

// Функция для удаления данных пользователя из базы данных
export async function deleteUserData(userId) {
    const client = await pool.connect()
    try {
        await client.query('DELETE FROM users WHERE user_id = $1', [userId])
    } finally {
        client.release()
    }
}
// Функция для сохранения пользователя в базе данных
export const saveUser = async (userId, login, token, userData, notificationsEnabled) => {
    const client = await pool.connect();
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
        );
    } finally {
        client.release();
    }
};

// Функция для получения пользователя из базы данных
export const getUser = async (userId) => {
    const client = await pool.connect();
    try {
        const result = await client.query(
            'SELECT * FROM users WHERE user_id = $1',
            [userId]
        );
        if (result.rows.length > 0) {
            const user = result.rows[0];
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
            };
        }
        return null;
    } finally {
        client.release();
    }
};

// Функция для обновления настроек уведомлений
 export const updateNotificationSettings = async (userId, enabled) => {
    const client = await pool.connect();
    try {
        await client.query(
            'UPDATE users SET notifications_enabled = $1 WHERE user_id = $2',
            [enabled, userId]
        );
    } finally {
        client.release();
    }
};
