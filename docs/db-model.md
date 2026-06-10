# Модель данных проекта

Для MVP используется JSON-хранилище на сервере. В реальном продукте его можно заменить на PostgreSQL или MongoDB без изменения пользовательской логики.

## User

- `id` — идентификатор пользователя
- `name` — имя
- `email` — email
- `role` — `organizer` или `participant`
- `passwordHash` — хэш пароля
- `createdAt` — дата регистрации

## Quiz

- `id` — идентификатор квиза
- `ownerId` — организатор
- `title` — название
- `category` — категория
- `timeLimit` — время на вопрос
- `rules` — правила
- `questions` — список вопросов
- `createdAt`, `updatedAt` — даты создания и обновления

## Question

- `id` — идентификатор вопроса
- `title` — текст вопроса
- `imageUrl` — ссылка на изображение
- `type` — `single` или `multiple`
- `options` — варианты ответа
- `correctIndexes` — индексы правильных ответов

## History

- `id` — идентификатор истории
- `quizId` — квиз
- `quizTitle` — название квиза
- `hostId` — организатор
- `roomCode` — код комнаты
- `startedAt`, `endedAt` — время проведения
- `results` — итоговый лидерборд
