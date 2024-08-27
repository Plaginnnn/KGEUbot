import { Markup } from 'telegraf';
import { getUser,saveUser } from './database.js';
import { getShortName } from './utils.js';
import { createMainMenu } from './menuFunctions.js';
import axios from 'axios'




// Функция для проверки валидности токена
export async function checkToken(token) {
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
            params: { login, password }
        });
        if (response.data.type === 'success') {
            const { token, userData } = response.data.payload;
            await saveUser(userId, login, token, userData, false, password);
            return token;
        }
        return null;
    } catch (error) {
        console.error('Ошибка при обновлении токена:', error.message);
        return null;
    }
}



//Функция для для проверки авторизации и создании меню
export async function createAuthenticatedMenu(ctx) {
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
// Middleware для проверки авторизации
export const authMiddleware = async (ctx, next) => {
    const userId = ctx.from.id;
    let user = await getUser(userId);
    if (user) {
        const isTokenValid = await checkToken(user.token);
        if (isTokenValid) {
            ctx.state.user = user;
            return next();
        } else {
            // Если токен недействителен, попытаться обновить его
            const newToken = await refreshToken(userId, user.login, user.password);
            if (newToken) {
                user.token = newToken;
                await saveUser(userId, user.login, newToken, user.userData, user.notificationsEnabled, user.password);
                ctx.state.user = user;
                return next();
            }
        }
    }
    const mainMenu = createMainMenu(false);
    await ctx.reply('Пожалуйста, войдите в систему с помощью кнопки "🔐 Войти"', mainMenu);
}

// Инициализация сессии
export const initSession = (ctx, next) => {
	if (!ctx.session) {
		ctx.session = {}
	}
	return next()
}


// Функция для получения данных БРС
export const fetchBRS = async (token, semester = null) => {
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
export const fetchRecordBook = async (token, semester = null) => {
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
export const getAvailableSemesters = async token => {
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