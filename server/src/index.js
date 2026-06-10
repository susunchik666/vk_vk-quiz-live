const path = require('path');
const crypto = require('crypto');
const express = require('express');
const cors = require('cors');
const http = require('http');
const { Server } = require('socket.io');
const { nanoid } = require('nanoid');
const { readDb, updateDb } = require('./db');

const PORT = process.env.PORT || 4000;
const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: '*', methods: ['GET', 'POST', 'PUT'] }
});

app.use(cors());
app.use(express.json({ limit: '2mb' }));

function hashPassword(password) {
  return crypto.createHash('sha256').update(String(password)).digest('hex');
}

function publicUser(user) {
  if (!user) return null;
  const { passwordHash, ...safe } = user;
  return safe;
}

function normalizeQuestion(question) {
  return {
    id: question.id || nanoid(8),
    title: question.title || 'Вопрос без названия',
    imageUrl: question.imageUrl || '',
    type: question.type === 'multiple' ? 'multiple' : 'single',
    options: Array.isArray(question.options) ? question.options.filter(Boolean) : [],
    correctIndexes: Array.isArray(question.correctIndexes)
      ? question.correctIndexes.map(Number).filter((n) => !Number.isNaN(n))
      : []
  };
}

function sanitizeQuestion(question) {
  if (!question) return null;
  const { correctIndexes, ...safe } = question;
  return safe;
}

function isCorrectAnswer(question, answerIndexes) {
  const actual = [...new Set((answerIndexes || []).map(Number))].sort((a, b) => a - b);
  const expected = [...new Set((question.correctIndexes || []).map(Number))].sort((a, b) => a - b);
  return JSON.stringify(actual) === JSON.stringify(expected);
}

function makeRoomCode() {
  return nanoid(6).toUpperCase();
}

const rooms = new Map();

app.get('/api/health', (req, res) => {
  res.json({ ok: true, name: 'VK Quiz Live API' });
});

app.post('/api/auth/register', (req, res) => {
  const { name, email, password, role } = req.body;
  if (!name || !email || !password) {
    return res.status(400).json({ message: 'Заполните имя, email и пароль.' });
  }
  const result = updateDb((db) => {
    const exists = db.users.find((user) => user.email.toLowerCase() === email.toLowerCase());
    if (exists) return { error: 'Пользователь с таким email уже существует.' };
    const user = {
      id: nanoid(10),
      name,
      email,
      role: role === 'organizer' ? 'organizer' : 'participant',
      passwordHash: hashPassword(password),
      createdAt: new Date().toISOString()
    };
    db.users.push(user);
    return { user: publicUser(user) };
  });
  if (result.error) return res.status(409).json({ message: result.error });
  res.json(result);
});

app.post('/api/auth/login', (req, res) => {
  const { email, password } = req.body;
  const db = readDb();
  const user = db.users.find((item) => item.email.toLowerCase() === String(email).toLowerCase());
  if (!user || user.passwordHash !== hashPassword(password)) {
    return res.status(401).json({ message: 'Неверный email или пароль.' });
  }
  res.json({ user: publicUser(user) });
});

app.get('/api/quizzes', (req, res) => {
  const { ownerId } = req.query;
  const db = readDb();
  const quizzes = ownerId ? db.quizzes.filter((quiz) => quiz.ownerId === ownerId) : db.quizzes;
  res.json({ quizzes });
});

app.post('/api/quizzes', (req, res) => {
  const { ownerId, title, category, timeLimit, rules, questions } = req.body;
  if (!ownerId || !title) return res.status(400).json({ message: 'Нужны ownerId и название квиза.' });
  const quiz = updateDb((db) => {
    const newQuiz = {
      id: nanoid(10),
      ownerId,
      title,
      category: category || 'Общее',
      timeLimit: Number(timeLimit) || 30,
      rules: rules || 'За правильный ответ начисляется 100 баллов.',
      questions: (questions || []).map(normalizeQuestion),
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
    db.quizzes.push(newQuiz);
    return newQuiz;
  });
  res.status(201).json({ quiz });
});

app.put('/api/quizzes/:id', (req, res) => {
  const { id } = req.params;
  const result = updateDb((db) => {
    const quiz = db.quizzes.find((item) => item.id === id);
    if (!quiz) return { error: 'Квиз не найден.' };
    quiz.title = req.body.title || quiz.title;
    quiz.category = req.body.category || quiz.category;
    quiz.timeLimit = Number(req.body.timeLimit) || quiz.timeLimit;
    quiz.rules = req.body.rules || quiz.rules;
    quiz.questions = Array.isArray(req.body.questions) ? req.body.questions.map(normalizeQuestion) : quiz.questions;
    quiz.updatedAt = new Date().toISOString();
    return { quiz };
  });
  if (result.error) return res.status(404).json({ message: result.error });
  res.json(result);
});

app.get('/api/quizzes/:id', (req, res) => {
  const db = readDb();
  const quiz = db.quizzes.find((item) => item.id === req.params.id);
  if (!quiz) return res.status(404).json({ message: 'Квиз не найден.' });
  res.json({ quiz });
});

app.post('/api/quizzes/:id/start', (req, res) => {
  const db = readDb();
  const quiz = db.quizzes.find((item) => item.id === req.params.id);
  if (!quiz) return res.status(404).json({ message: 'Квиз не найден.' });
  if (!quiz.questions.length) return res.status(400).json({ message: 'Добавьте хотя бы один вопрос.' });
  let code = makeRoomCode();
  while (rooms.has(code)) code = makeRoomCode();
  const room = {
    code,
    quizId: quiz.id,
    hostId: quiz.ownerId,
    status: 'waiting',
    questionIndex: -1,
    questionStartedAt: null,
    participants: {},
    answers: {},
    createdAt: new Date().toISOString()
  };
  rooms.set(code, room);
  res.json({ roomCode: code, quiz });
});

app.get('/api/users/:id/history', (req, res) => {
  const db = readDb();
  const userId = req.params.id;
  const createdQuizzes = db.quizzes.filter((quiz) => quiz.ownerId === userId);
  const histories = db.histories.filter((history) =>
    history.hostId === userId || history.results.some((result) => result.id === userId)
  );
  res.json({ createdQuizzes, histories });
});

function getQuizForRoom(room) {
  const db = readDb();
  return db.quizzes.find((quiz) => quiz.id === room.quizId);
}

function emitRoomState(room) {
  const quiz = getQuizForRoom(room);
  io.to(room.code).emit('room-state', {
    code: room.code,
    quizTitle: quiz ? quiz.title : 'Квиз',
    status: room.status,
    questionIndex: room.questionIndex,
    totalQuestions: quiz ? quiz.questions.length : 0,
    participants: Object.values(room.participants),
    leaderboard: Object.values(room.participants).sort((a, b) => b.score - a.score)
  });
}

function startQuestion(room) {
  const quiz = getQuizForRoom(room);
  if (!quiz) return;
  const question = quiz.questions[room.questionIndex];
  room.status = 'question';
  room.questionStartedAt = Date.now();
  room.answers = {};
  io.to(room.code).emit('question-start', {
    question: sanitizeQuestion(question),
    questionIndex: room.questionIndex,
    totalQuestions: quiz.questions.length,
    timeLimit: quiz.timeLimit
  });
  emitRoomState(room);
}

function finishRoom(room) {
  const quiz = getQuizForRoom(room);
  room.status = 'finished';
  const results = Object.values(room.participants).sort((a, b) => b.score - a.score);
  updateDb((db) => {
    db.histories.push({
      id: nanoid(10),
      quizId: room.quizId,
      quizTitle: quiz ? quiz.title : 'Квиз',
      hostId: room.hostId,
      roomCode: room.code,
      startedAt: room.createdAt,
      endedAt: new Date().toISOString(),
      results
    });
  });
  io.to(room.code).emit('quiz-finished', { leaderboard: results });
  emitRoomState(room);
}

io.on('connection', (socket) => {
  socket.on('host-room', ({ code, userId }) => {
    const room = rooms.get(String(code).toUpperCase());
    if (!room) return socket.emit('error-message', 'Комната не найдена.');
    if (room.hostId !== userId) return socket.emit('error-message', 'Нет доступа к управлению комнатой.');
    socket.join(room.code);
    socket.data.roomCode = room.code;
    socket.data.userId = userId;
    emitRoomState(room);
  });

  socket.on('join-room', ({ code, user }) => {
    const room = rooms.get(String(code).toUpperCase());
    if (!room) return socket.emit('error-message', 'Комната не найдена.');
    if (room.status === 'finished') return socket.emit('error-message', 'Квиз уже завершён.');
    const participant = {
      id: user.id,
      name: user.name || 'Участник',
      score: room.participants[user.id]?.score || 0,
      answersCount: room.participants[user.id]?.answersCount || 0
    };
    room.participants[user.id] = participant;
    socket.join(room.code);
    socket.data.roomCode = room.code;
    socket.data.userId = user.id;
    socket.emit('joined-room', { code: room.code });
    emitRoomState(room);
  });

  socket.on('host-start', ({ code, userId }) => {
    const room = rooms.get(String(code).toUpperCase());
    if (!room || room.hostId !== userId) return;
    room.questionIndex = 0;
    startQuestion(room);
  });

  socket.on('host-next', ({ code, userId }) => {
    const room = rooms.get(String(code).toUpperCase());
    if (!room || room.hostId !== userId) return;
    const quiz = getQuizForRoom(room);
    if (!quiz) return;
    if (room.questionIndex + 1 >= quiz.questions.length) return finishRoom(room);
    room.questionIndex += 1;
    startQuestion(room);
  });

  socket.on('submit-answer', ({ code, userId, answerIndexes }) => {
    const room = rooms.get(String(code).toUpperCase());
    if (!room || room.status !== 'question') return;
    if (!room.participants[userId]) return;
    if (room.answers[userId]) return;
    const quiz = getQuizForRoom(room);
    const question = quiz?.questions[room.questionIndex];
    if (!question) return;
    const elapsed = Math.floor((Date.now() - room.questionStartedAt) / 1000);
    const timeBonus = Math.max(0, (quiz.timeLimit || 30) - elapsed);
    const correct = isCorrectAnswer(question, answerIndexes);
    const scoreDelta = correct ? 100 + timeBonus : 0;
    room.answers[userId] = { answerIndexes, correct, scoreDelta };
    room.participants[userId].score += scoreDelta;
    room.participants[userId].answersCount += 1;
    socket.emit('answer-result', { correct, scoreDelta });
    emitRoomState(room);
  });

  socket.on('host-finish', ({ code, userId }) => {
    const room = rooms.get(String(code).toUpperCase());
    if (!room || room.hostId !== userId) return;
    finishRoom(room);
  });

  socket.on('disconnect', () => {
    const code = socket.data.roomCode;
    if (code && rooms.has(code)) emitRoomState(rooms.get(code));
  });
});

const clientDist = path.join(__dirname, '..', '..', 'client', 'dist');
app.use(express.static(clientDist));
app.get('*', (req, res, next) => {
  if (req.path.startsWith('/api')) return next();
  res.sendFile(path.join(clientDist, 'index.html'), (err) => {
    if (err) res.status(200).send('VK Quiz Live API is running. Build client to serve frontend.');
  });
});

server.listen(PORT, () => {
  console.log(`VK Quiz Live server started on http://localhost:${PORT}`);
});
