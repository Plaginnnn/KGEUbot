
// Функция форматирования даты
export const formatDate = dateString => {
	const date = new Date(dateString)
	return date.toLocaleDateString('ru-RU', {
		day: '2-digit',
		month: '2-digit',
		year: 'numeric',
	})
}

// Функция для удаления предыдущих сообщений
export const deleteAllPreviousMessages = async ctx => {
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
// Функция для получения сокращенного имени
export const getShortName = (lastName, firstName, parentName) => {
	return `${lastName} ${firstName[0]}.${parentName[0]}.`
}

