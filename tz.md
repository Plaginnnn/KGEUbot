Необходимо написать бота для телеграмм, используя библиотку telegraf, пока что есть только config export const config = {
	telegramToken: '7415179094:AAHyPLljfNicW5Kn_owAqbwmOhz5tnyn7wA',
}
, которые предостовялет расписание занятий, которые он получает по api с сервера, но нужно учитывать что бот и backend находяться на разных серверах, таким образом нужно как то обходить процессы которые буду мешать такие как cors и так далее, учти что нужно использовать axios. 
План того как должен работать бот:
 1)Для начала мы должны в боте авторизоваться, тоесть бот спрашивает логин и пароль пользовтаеля, потом чтоб проверить бот должен отправлять запрос в таком формате, https://iep.kgeu.ru/api/auth?login=mulyukov.rasim@mail.ru&password=Q49KD07ob5, как ты можешь заметить я передаю в query параметрах данные, и после того как я отправил данные, с  сервера мне приходит вот такой json, в этом json нужно поприветствовать пользователя, используя эти данные  "FirstName": "Расим",
            "LastName": "Мулюков",
            "ParentName": "Ильясович",
						после этого твоя задача сохранить данные логина и пароля пользователя, это нужно чтобы не авторизироваться пользователю несмколько раз, ведь когда я отправил данные мне нужно запомнить "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpZCI6NTI5Niwicm9sZSI6IlVTRVIiLCJleHAiOjE3MjAzOTUxMzM5ODIsImlhdCI6MTcyMDMwODczM30.esMC5I48PipiVWGnBeesiD97X8ONIhhIQJncJkm57Cw",
						который будет меняться каждый раз когда я буду отправлять пароль и логин на сервер
 {
    "type": "success",
    "payload": {
        "user": {
            "id": 5296,
            "createdAt": "2021-09-09T03:37:06.639Z",
            "updatedAt": "2021-09-09T03:37:06.639Z",
            "isuId": 23920,
            "role": "USER"
        },
        "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpZCI6NTI5Niwicm9sZSI6IlVTRVIiLCJleHAiOjE3MjAzOTUxMzM5ODIsImlhdCI6MTcyMDMwODczM30.esMC5I48PipiVWGnBeesiD97X8ONIhhIQJncJkm57Cw",
        "userData": {
            "UserName": "mulyukov.rasim@mail.ru",
            "Pass": "6b45b9adcd9f69e5aa146935c1f93f753097dba8",
            "EMail": "mulyukov.rasim@Mail.ru",
            "FirstName": "Расим",
            "LastName": "Мулюков",
            "ParentName": "Ильясович",
            "City": "Казань",
            "Country": "RU",
            "Dept": "",
            "Position": "Студент",
            "Cabinet": "",
            "Phone": "",
            "IdUserType": 2,
            "IsBlocked": false,
            "IsPassSyncronized": false,
            "CreateDate": "2021-08-31T21:29:02.607Z",
            "IdUser": 23920,
            "ConfirmCode": "691339",
            "AttemptCount": 0,
            "LastAccess": "2024-07-06T07:10:05.694Z",
            "IdBlockReason": null,
            "IsActivated": null,
            "IdPerson": null,
            "PersDataProcessingAccepted": null
        }
    }
}
для начала этого функционала достаточно, тоесть  мне важно чтобы в переписен бот помнил данные пользователя, и сделай пока что базовые команды на смену данных и тд 