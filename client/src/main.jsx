import React, { useEffect, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { io } from 'socket.io-client';
import './styles.css';

const API_URL = import.meta.env.VITE_API_URL || '';
const SOCKET_URL = import.meta.env.VITE_SOCKET_URL || 'http://localhost:4000';

async function api(path, options = {}) {
  const response = await fetch(`${API_URL}${path}`, {
    headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
    ...options,
    body: options.body ? JSON.stringify(options.body) : undefined
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.message || 'Ошибка запроса');
  return data;
}

function App() {
  const [user, setUser] = useState(() => JSON.parse(localStorage.getItem('vk_quiz_user') || 'null'));
  const [screen, setScreen] = useState('dashboard');
  const [activeRoom, setActiveRoom] = useState(null);
  const [activeQuiz, setActiveQuiz] = useState(null);

  function saveUser(nextUser) {
    setUser(nextUser);
    localStorage.setItem('vk_quiz_user', JSON.stringify(nextUser));
  }

  function logout() {
    localStorage.removeItem('vk_quiz_user');
    setUser(null);
    setScreen('dashboard');
  }

  if (!user) return <Auth onAuth={saveUser} />;

  return (
    <div className="app-shell">
      <header className="topbar">
        <div>
          <div className="logo">VK Quiz Live</div>
          <div className="muted">Интерактивные квизы в реальном времени</div>
        </div>
        <nav className="nav">
          <button onClick={() => setScreen('dashboard')}>Кабинет</button>
          {user.role === 'organizer' && <button onClick={() => setScreen('create')}>Создать квиз</button>}
          {user.role === 'participant' && <button onClick={() => setScreen('join')}>Войти по коду</button>}
          <button className="ghost" onClick={logout}>Выйти</button>
        </nav>
      </header>

      {screen === 'dashboard' && (
        <Dashboard
          user={user}
          onCreate={() => setScreen('create')}
          onJoin={() => setScreen('join')}
          onHost={(roomCode, quiz) => {
            setActiveRoom(roomCode);
            setActiveQuiz(quiz);
            setScreen('host');
          }}
        />
      )}
      {screen === 'create' && <QuizEditor user={user} onDone={() => setScreen('dashboard')} />}
      {screen === 'join' && <JoinRoom user={user} onJoined={(code) => { setActiveRoom(code); setScreen('play'); }} />}
      {screen === 'host' && <HostRoom user={user} roomCode={activeRoom} quiz={activeQuiz} />}
      {screen === 'play' && <PlayRoom user={user} roomCode={activeRoom} />}
    </div>
  );
}

function Auth({ onAuth }) {
  const [mode, setMode] = useState('login');
  const [form, setForm] = useState({ name: '', email: '', password: '', role: 'organizer' });
  const [error, setError] = useState('');

  async function submit(event) {
    event.preventDefault();
    setError('');
    try {
      const data = await api(`/api/auth/${mode === 'login' ? 'login' : 'register'}`, {
        method: 'POST',
        body: form
      });
      onAuth(data.user);
    } catch (err) {
      setError(err.message);
    }
  }

  return (
    <main className="auth-page">
      <section className="hero-card">
        <span className="badge">VK Education Project</span>
        <h1>Платформа для живых квизов на мероприятиях</h1>
        <p>Создавайте викторины, подключайте участников по коду комнаты и показывайте лидерборд в реальном времени.</p>
      </section>
      <form className="card auth-form" onSubmit={submit}>
        <h2>{mode === 'login' ? 'Вход' : 'Регистрация'}</h2>
        {mode === 'register' && (
          <label>Имя<input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required /></label>
        )}
        <label>Email<input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} required /></label>
        <label>Пароль<input type="password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} required /></label>
        {mode === 'register' && (
          <label>Роль<select value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })}>
            <option value="organizer">Организатор</option>
            <option value="participant">Участник</option>
          </select></label>
        )}
        {error && <p className="error">{error}</p>}
        <button className="primary">{mode === 'login' ? 'Войти' : 'Создать аккаунт'}</button>
        <button type="button" className="link-button" onClick={() => setMode(mode === 'login' ? 'register' : 'login')}>
          {mode === 'login' ? 'Нет аккаунта? Зарегистрироваться' : 'Уже есть аккаунт? Войти'}
        </button>
      </form>
    </main>
  );
}

function Dashboard({ user, onCreate, onJoin, onHost }) {
  const [data, setData] = useState({ createdQuizzes: [], histories: [] });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api(`/api/users/${user.id}/history`).then(setData).finally(() => setLoading(false));
  }, [user.id]);

  async function startQuiz(quiz) {
    const result = await api(`/api/quizzes/${quiz.id}/start`, { method: 'POST', body: { ownerId: user.id } });
    onHost(result.roomCode, result.quiz);
  }

  return (
    <main className="grid two-cols">
      <section className="card">
        <span className="badge">{user.role === 'organizer' ? 'Организатор' : 'Участник'}</span>
        <h1>Привет, {user.name}!</h1>
        <p className="muted">Это личный кабинет с историей квизов и быстрыми действиями.</p>
        {user.role === 'organizer' ? <button className="primary" onClick={onCreate}>Создать новый квиз</button> : <button className="primary" onClick={onJoin}>Подключиться по коду</button>}
      </section>
      <section className="card">
        <h2>{user.role === 'organizer' ? 'Мои квизы' : 'История участия'}</h2>
        {loading && <p>Загрузка...</p>}
        {user.role === 'organizer' && data.createdQuizzes.map((quiz) => (
          <div className="list-item" key={quiz.id}>
            <div><strong>{quiz.title}</strong><p>{quiz.category} · {quiz.questions.length} вопросов</p></div>
            <button onClick={() => startQuiz(quiz)}>Запустить комнату</button>
          </div>
        ))}
        {user.role === 'participant' && data.histories.map((history) => (
          <div className="list-item" key={history.id}>
            <div><strong>{history.quizTitle}</strong><p>Код комнаты: {history.roomCode}</p></div>
          </div>
        ))}
        {!loading && user.role === 'organizer' && data.createdQuizzes.length === 0 && <p className="muted">Квизов пока нет.</p>}
        {!loading && user.role === 'participant' && data.histories.length === 0 && <p className="muted">История пока пустая.</p>}
      </section>
    </main>
  );
}

function QuizEditor({ user, onDone }) {
  const [quiz, setQuiz] = useState({
    title: 'Квиз о VK и digital-продуктах',
    category: 'Digital',
    timeLimit: 30,
    rules: 'За правильный ответ начисляется 100 баллов и бонус за скорость.',
    questions: [
      { title: 'Что такое MVP?', imageUrl: '', type: 'single', options: ['Готовый продукт', 'Минимально жизнеспособный продукт', 'Дизайн-макет'], correctIndexes: [1] },
      { title: 'Какие технологии нужны для real-time взаимодействия?', imageUrl: '', type: 'multiple', options: ['HTML', 'Socket.IO', 'WebSocket', 'Только CSS'], correctIndexes: [1, 2] }
    ]
  });
  const [message, setMessage] = useState('');

  function updateQuestion(index, patch) {
    const questions = [...quiz.questions];
    questions[index] = { ...questions[index], ...patch };
    setQuiz({ ...quiz, questions });
  }

  function updateOption(qIndex, oIndex, value) {
    const question = quiz.questions[qIndex];
    const options = [...question.options];
    options[oIndex] = value;
    updateQuestion(qIndex, { options });
  }

  function toggleCorrect(qIndex, oIndex) {
    const question = quiz.questions[qIndex];
    let correctIndexes = question.correctIndexes || [];
    if (question.type === 'single') correctIndexes = [oIndex];
    else correctIndexes = correctIndexes.includes(oIndex) ? correctIndexes.filter((item) => item !== oIndex) : [...correctIndexes, oIndex];
    updateQuestion(qIndex, { correctIndexes });
  }

  async function submit(event) {
    event.preventDefault();
    const data = await api('/api/quizzes', { method: 'POST', body: { ...quiz, ownerId: user.id } });
    setMessage(`Квиз «${data.quiz.title}» сохранён.`);
    setTimeout(onDone, 800);
  }

  return (
    <main className="card wide">
      <h1>Создание квиза</h1>
      <form onSubmit={submit} className="form-grid">
        <label>Название<input value={quiz.title} onChange={(e) => setQuiz({ ...quiz, title: e.target.value })} required /></label>
        <label>Категория<input value={quiz.category} onChange={(e) => setQuiz({ ...quiz, category: e.target.value })} /></label>
        <label>Время на вопрос, сек.<input type="number" value={quiz.timeLimit} onChange={(e) => setQuiz({ ...quiz, timeLimit: e.target.value })} /></label>
        <label className="full">Правила<textarea value={quiz.rules} onChange={(e) => setQuiz({ ...quiz, rules: e.target.value })} /></label>

        <div className="full section-title">Вопросы</div>
        {quiz.questions.map((question, qIndex) => (
          <article className="question-editor" key={qIndex}>
            <label>Текст вопроса<input value={question.title} onChange={(e) => updateQuestion(qIndex, { title: e.target.value })} /></label>
            <label>Ссылка на изображение<input value={question.imageUrl} onChange={(e) => updateQuestion(qIndex, { imageUrl: e.target.value })} placeholder="https://..." /></label>
            <label>Тип ответа<select value={question.type} onChange={(e) => updateQuestion(qIndex, { type: e.target.value, correctIndexes: [] })}>
              <option value="single">Один ответ</option>
              <option value="multiple">Несколько ответов</option>
            </select></label>
            <div className="options">
              {question.options.map((option, oIndex) => (
                <div className="option-row" key={oIndex}>
                  <input value={option} onChange={(e) => updateOption(qIndex, oIndex, e.target.value)} />
                  <label className="check-label">
                    <input type={question.type === 'single' ? 'radio' : 'checkbox'} name={`correct-${qIndex}`} checked={(question.correctIndexes || []).includes(oIndex)} onChange={() => toggleCorrect(qIndex, oIndex)} />
                    правильный
                  </label>
                </div>
              ))}
            </div>
          </article>
        ))}
        <button type="button" onClick={() => setQuiz({ ...quiz, questions: [...quiz.questions, { title: '', imageUrl: '', type: 'single', options: ['Вариант 1', 'Вариант 2', 'Вариант 3'], correctIndexes: [0] }] })}>Добавить вопрос</button>
        <button className="primary">Сохранить квиз</button>
      </form>
      {message && <p className="success">{message}</p>}
    </main>
  );
}

function JoinRoom({ user, onJoined }) {
  const [code, setCode] = useState('');
  return (
    <main className="card compact">
      <h1>Подключение к квизу</h1>
      <p className="muted">Введите код комнаты, который показывает организатор.</p>
      <input className="room-input" value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} placeholder="Например, VK123A" />
      <button className="primary" onClick={() => code && onJoined(code)}>Войти в комнату</button>
    </main>
  );
}

function useSocketRoom(roomCode, user, mode) {
  const [socket, setSocket] = useState(null);
  const [room, setRoom] = useState(null);
  const [question, setQuestion] = useState(null);
  const [result, setResult] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!roomCode) return;
    const nextSocket = io(SOCKET_URL, { transports: ['websocket', 'polling'] });
    setSocket(nextSocket);
    nextSocket.on('connect', () => {
      if (mode === 'host') nextSocket.emit('host-room', { code: roomCode, userId: user.id });
      else nextSocket.emit('join-room', { code: roomCode, user });
    });
    nextSocket.on('room-state', setRoom);
    nextSocket.on('question-start', (payload) => { setQuestion(payload); setResult(null); });
    nextSocket.on('answer-result', setResult);
    nextSocket.on('quiz-finished', (payload) => { setQuestion(null); setRoom((prev) => ({ ...(prev || {}), status: 'finished', leaderboard: payload.leaderboard })); });
    nextSocket.on('error-message', setError);
    return () => nextSocket.disconnect();
  }, [roomCode, user.id, mode]);

  return { socket, room, question, result, error };
}

function HostRoom({ user, roomCode }) {
  const { socket, room, question, error } = useSocketRoom(roomCode, user, 'host');
  const leaderboard = room?.leaderboard || [];
  return (
    <main className="grid two-cols">
      <section className="card">
        <span className="badge">Код комнаты</span>
        <div className="room-code">{roomCode}</div>
        {error && <p className="error">{error}</p>}
        <p className="muted">Участники вводят этот код в приложении.</p>
        <div className="actions">
          <button className="primary" onClick={() => socket?.emit('host-start', { code: roomCode, userId: user.id })}>Запустить первый вопрос</button>
          <button onClick={() => socket?.emit('host-next', { code: roomCode, userId: user.id })}>Следующий вопрос</button>
          <button className="danger" onClick={() => socket?.emit('host-finish', { code: roomCode, userId: user.id })}>Завершить</button>
        </div>
        {question && <QuestionPreview payload={question} />}
      </section>
      <Leaderboard room={room} leaderboard={leaderboard} />
    </main>
  );
}

function PlayRoom({ user, roomCode }) {
  const { socket, room, question, result, error } = useSocketRoom(roomCode, user, 'player');
  const [selected, setSelected] = useState([]);

  useEffect(() => setSelected([]), [question?.question?.id]);

  function toggle(index) {
    const q = question.question;
    if (q.type === 'single') setSelected([index]);
    else setSelected(selected.includes(index) ? selected.filter((item) => item !== index) : [...selected, index]);
  }

  if (room?.status === 'finished') return <main className="card wide"><Leaderboard room={room} leaderboard={room.leaderboard || []} /></main>;

  return (
    <main className="card wide">
      <span className="badge">Комната {roomCode}</span>
      <h1>{room?.quizTitle || 'Ожидание квиза'}</h1>
      {error && <p className="error">{error}</p>}
      {!question && <p className="muted">Ожидаем, когда организатор запустит вопрос...</p>}
      {question && (
        <section className="live-question">
          <p className="muted">Вопрос {question.questionIndex + 1} из {question.totalQuestions}. Время: {question.timeLimit} сек.</p>
          <h2>{question.question.title}</h2>
          {question.question.imageUrl && <img src={question.question.imageUrl} alt="Иллюстрация к вопросу" />}
          <div className="answer-grid">
            {question.question.options.map((option, index) => (
              <button key={index} className={selected.includes(index) ? 'answer selected' : 'answer'} onClick={() => toggle(index)}>{option}</button>
            ))}
          </div>
          <button className="primary" disabled={!selected.length || result} onClick={() => socket?.emit('submit-answer', { code: roomCode, userId: user.id, answerIndexes: selected })}>Отправить ответ</button>
          {result && <p className={result.correct ? 'success' : 'error'}>{result.correct ? `Верно! +${result.scoreDelta}` : 'Неверно, баллы не начислены.'}</p>}
        </section>
      )}
    </main>
  );
}

function QuestionPreview({ payload }) {
  return (
    <section className="live-question preview">
      <p className="muted">Вопрос {payload.questionIndex + 1} из {payload.totalQuestions}</p>
      <h2>{payload.question.title}</h2>
      {payload.question.imageUrl && <img src={payload.question.imageUrl} alt="Иллюстрация к вопросу" />}
      <div className="answer-grid">
        {payload.question.options.map((option, index) => <div className="answer" key={index}>{option}</div>)}
      </div>
    </section>
  );
}

function Leaderboard({ room, leaderboard }) {
  return (
    <section className="card">
      <h2>Лидерборд</h2>
      <p className="muted">Статус: {room?.status || 'ожидание'} · участников: {room?.participants?.length || 0}</p>
      {(leaderboard || []).map((player, index) => (
        <div className="leader" key={player.id}>
          <span>#{index + 1}</span>
          <strong>{player.name}</strong>
          <b>{player.score} баллов</b>
        </div>
      ))}
      {(!leaderboard || leaderboard.length === 0) && <p className="muted">Пока нет участников.</p>}
    </section>
  );
}

createRoot(document.getElementById('root')).render(<App />);
