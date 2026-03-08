# Squared v2 — Technical Plan

## Поточний стан

### Що працює
- Gemini Live API (WebSocket) — real-time audio + video streaming
- MediaPipe (face + pose) — eye contact, posture detection (local)
- Audio analysis — pace (WPM), filler words, volume (local)
- Tool calling `updateIndicators` — Gemini оновлює UI
- Rehearsal Mode — голосовий коуч з перебиваннями
- Presentation Mode — мовчки, тільки HUD
- CameraOverlay — badges поверх відео (eye contact, pace, posture)
- SessionInsights — розгорнута панель метрик (rehearsal)
- SQLite persistence — runs + feedbacks (базовий)
- Dashboard — перегляд сесій
- Speech plan upload — текстовий контекст (text/md/csv/json)

### Архітектура зараз
```
Monolith (Vite + Express plugin)
├── Frontend: React 19 + Tailwind 4
├── Backend: Express routes вбудовані у vite.config.ts
├── DB: SQLite (better-sqlite3) — файл database.sqlite
└── Deploy: Google AI Studio (single process)
```

---

## Цільова архітектура

### Три компоненти
```
1. Backend (API Server)
   ├── Express standalone
   ├── SQLite (projects, runs, feedbacks, analyses, game_plans)
   ├── File storage (uploaded presentations)
   ├── Analysis aggregation engine
   └── REST API

2. Frontend (Web App)
   ├── React 19 + Tailwind 4
   ├── Rehearsal Mode (існує)
   ├── Presentation Mode (існує, треба оновити overlay)
   ├── Project management (НОВЕ)
   ├── Game Plan view (НОВЕ)
   └── Builds у static files → Electron завантажує

3. Electron Shell (Mac App)
   ├── Loads frontend
   ├── Floating overlay window (NSWindow.sharingType = .none)
   ├── Tray icon
   └── IPC: overlay ↔ main window
```

---

## Зміни по компонентах

### 1. Backend — виділити в окремий сервер

#### Чому
Зараз Express вбудований у Vite dev plugin (`vite.config.ts`). Це працює тільки в dev mode і не підтримує production. Для Electron потрібен standalone backend.

#### Що зробити

**Структура:**
```
server/
├── index.ts          — Express app entry
├── routes/
│   ├── projects.ts   — CRUD projects
│   ├── runs.ts       — CRUD runs (існуючий, розширити)
│   └── analyses.ts   — aggregated analysis + game plans
├── db/
│   ├── schema.ts     — all table definitions
│   ├── migrations.ts — schema migrations
│   └── queries.ts    — prepared statements
├── services/
│   ├── analysis.ts   — run analysis aggregation logic
│   └── gameplan.ts   — game plan generation from aggregated data
└── storage/
    └── uploads/      — uploaded presentation files
```

**Нова DB схема:**
```sql
-- Проєкти (презентації)
CREATE TABLE projects (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  -- зміст презентації (текст витягнутий з файлу)
  content TEXT,
  -- оригінальний файл
  file_path TEXT,
  file_type TEXT,           -- 'pptx' | 'pdf' | 'text' | 'md'
  slide_count INTEGER,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Структура презентації (по слайдах)
CREATE TABLE project_slides (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  slide_number INTEGER NOT NULL,
  title TEXT,
  content TEXT,              -- текст слайда
  speaker_notes TEXT,
  FOREIGN KEY(project_id) REFERENCES projects(id) ON DELETE CASCADE
);

-- Рани (розширити існуючу таблицю)
CREATE TABLE runs (
  id TEXT PRIMARY KEY,
  project_id TEXT,           -- НОВЕ: прив'язка до проєкту
  mode TEXT NOT NULL,        -- 'rehearsal' | 'presentation'
  duration INTEGER NOT NULL,
  -- НОВЕ: агреговані метрики за ран
  avg_pace_wpm REAL,
  avg_confidence REAL,
  filler_word_count INTEGER,
  eye_contact_pct REAL,      -- % часу дивився в камеру
  posture_good_pct REAL,     -- % часу правильна постура
  overall_score REAL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(project_id) REFERENCES projects(id) ON DELETE SET NULL
);

-- Фідбеки (існує, розширити)
CREATE TABLE feedbacks (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL,
  timestamp TEXT NOT NULL,
  message TEXT NOT NULL,
  -- НОВЕ:
  slide_number INTEGER,      -- на якому слайді був фідбек
  severity TEXT,             -- 'info' | 'warning' | 'critical'
  category TEXT,             -- 'pace' | 'eye_contact' | 'posture' | 'content' | 'structure' | 'filler'
  FOREIGN KEY(run_id) REFERENCES runs(id) ON DELETE CASCADE
);

-- НОВЕ: Аналіз слабких місць (агрегація по ранах)
CREATE TABLE risk_segments (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  slide_number INTEGER,
  risk_type TEXT NOT NULL,   -- 'pace_spike' | 'freeze' | 'filler_cluster' | 'eye_contact_loss' | 'confidence_drop'
  frequency INTEGER,         -- скільки разів зафіксовано
  avg_severity REAL,
  last_occurrence DATETIME,
  best_recovery TEXT,        -- найкраща фраза/стратегія відновлення
  notes TEXT,
  FOREIGN KEY(project_id) REFERENCES projects(id) ON DELETE CASCADE
);

-- НОВЕ: Game Plan (генерується перед presentation mode)
CREATE TABLE game_plans (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  run_count INTEGER,         -- на базі скількох ранів згенеровано
  -- JSON структура плану
  plan_json TEXT NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(project_id) REFERENCES projects(id) ON DELETE CASCADE
);
```

**Game Plan JSON структура:**
```typescript
interface GamePlan {
  overview: {
    totalRuns: number;
    avgScore: number;
    trend: 'improving' | 'stable' | 'declining';
  };
  segments: Array<{
    slideNumber: number;
    slideTitle: string;
    riskLevel: 'safe' | 'watch' | 'fragile';
    knownIssues: string[];       // "pace spikes here", "loses eye contact"
    preparedCues: string[];      // "Зроби паузу перед цим слайдом"
    recoveryPhrases: string[];   // фрази з минулих ранів що спрацювали
    interventionPolicy: 'silent' | 'soft_cue' | 'directive' | 'teleprompter';
  }>;
  attentionBudget: {
    maxInterventions: number;     // скільки разів агент може втрутитись
    prioritySlides: number[];     // слайди де втручання найважливіше
  };
  timingStrategy: {
    totalTargetMinutes: number;
    perSlideTargets: Record<number, number>;  // slide -> seconds
  };
}
```

**API Endpoints:**
```
# Projects
POST   /api/projects              — створити проєкт
GET    /api/projects              — список проєктів
GET    /api/projects/:id          — деталі проєкту
PUT    /api/projects/:id          — оновити проєкт
DELETE /api/projects/:id          — видалити проєкт
POST   /api/projects/:id/upload   — завантажити файл презентації

# Runs (розширити існуючі)
POST   /api/runs                  — зберегти ран (+ project_id, + metrics)
GET    /api/runs?project_id=X     — рани по проєкту
GET    /api/runs/:id              — деталі рану

# Analysis
GET    /api/projects/:id/analysis — агрегований аналіз по всіх ранах
GET    /api/projects/:id/risks    — risk segments
POST   /api/projects/:id/gameplan — згенерувати game plan

# Game Plan
GET    /api/gameplans/:id         — отримати game plan
GET    /api/projects/:id/gameplan/latest — останній game plan
```

---

### 2. Frontend — нові екрани та оновлення існуючих

#### Нові компоненти

**ProjectList.tsx** — список проєктів
```
- Картки проєктів з назвою, кількістю ранів, останнім score
- Кнопка "New Project"
- Quick actions: Rehearse / Present / View Analysis
```

**ProjectSetup.tsx** — створення/редагування проєкту
```
- Назва проєкту
- Drag & drop upload презентації (PPTX/PDF/TXT)
- Preview витягнутих слайдів (titles + content)
- Редагування speaker notes
```

**GamePlanView.tsx** — перегляд game plan перед presentation
```
- Візуалізація risk map по слайдах (зелений/жовтий/червоний)
- Intervention policy per slide
- Prepared cues preview
- Attention budget indicator
- Кнопка "Start Presentation with this Plan"
```

**RunAnalysis.tsx** — аналіз конкретного рану (замість простого Dashboard)
```
- Timeline з подіями
- Per-slide breakdown
- Порівняння з попередніми ранами
- Highlights: де найгірше, де покращення
```

#### Оновлення існуючих компонентів

**Home.tsx → переробити**
```
Замість 3 кнопок (rehearsal / presentation / dashboard):
- Project-centric navigation
- Вибираєш проєкт → бачиш його рани → вибираєш mode
```

**RehearsalMode.tsx → оновити**
```
- Приймає project_id
- Контекст слайдів передається в system prompt Gemini
- По завершенні зберігає розширені метрики (per-slide breakdown)
- System prompt включає знання про структуру презентації
```

**PresentationMode.tsx → оновити**
```
- Приймає project_id + game_plan_id
- Завантажує game plan перед початком
- System prompt включає:
  - структуру презентації
  - risk segments
  - prepared cues
  - recovery phrases
  - attention budget
  - timing strategy
- Overlay показує:
  - поточний cue (якщо є)
  - micro-prompt (1-3 слова)
  - timing indicator
  - rescue teleprompter (коли потрібно)
```

**CameraOverlay.tsx → переробити для Presentation mode**
```
Замість статичних badges:
- Мінімальний режим: 1 рядок тексту (micro-prompt)
- Rescue режим: 2-3 рядки (teleprompter)
- Timing bar: скільки часу на цей слайд
- Плавні transitions між станами
- Кольорова індикація стану: green (stable) → amber (watch) → red (rescue)
```

**System Prompts → переробити**

Rehearsal system prompt має включати:
```
- Структуру презентації (слайди, контент)
- Інструкцію: відстежувати по голосу на якому слайді користувач
- Інструкцію: фіксувати проблемні переходи
- Фрази типу "Це той самий перехід де ти губився минулого разу"
- Використовувати tool calling для збереження per-slide metrics
```

Presentation system prompt має включати:
```
- Всю інформацію з game plan
- Risk segments з конкретними cues
- Recovery phrases з минулих ранів
- Attention budget: "ти можеш втрутитися максимум N разів"
- Timing targets per slide
- Інструкцію: давати ТІЛЬКИ [контекст] + [дія], максимально коротко
- Інструкцію: кожна фраза має показувати що агент розуміє контекст
```

#### Нові tool calls для Gemini

```typescript
// Розширити updateIndicators
updateIndicators: {
  // існуючі поля...
  currentSlide: number,          // НОВЕ: на якому слайді зараз
  microPrompt: string,           // НОВЕ: коротка підказка (1-3 слова)
  rescueText: string,            // НОВЕ: телепромптер (коли rescue mode)
  agentMode: 'monitor' | 'soft_cue' | 'directive' | 'rescue',  // НОВЕ
  slideTimeRemaining: number,    // НОВЕ: секунди до переходу
}

// НОВИЙ tool: зберігати аналіз слайда під час рану
saveSlideAnalysis: {
  slideNumber: number,
  issues: string[],
  bestPhrase: string,            // найкраще формулювання яке юзер сказав
  riskLevel: 'safe' | 'watch' | 'fragile',
}
```

---

### 3. Electron Shell

#### Структура
```
electron/
├── main.ts              — main process
├── preload.ts           — preload script
├── overlay.ts           — overlay window logic
├── tray.ts              — tray icon + menu
└── ipc.ts               — IPC handlers
```

#### Ключові рішення

**Main Window:**
- BrowserWindow що завантажує frontend (localhost:3000 в dev, або static build)
- Стандартне вікно, тут весь UI: projects, rehearsal, dashboard

**Overlay Window:**
- Окремий BrowserWindow:
  ```typescript
  const overlay = new BrowserWindow({
    transparent: true,
    frame: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    hasShadow: false,
    // Ключове: невидимий для screen sharing
    // macOS: NSWindow.sharingType = .none
    type: 'panel',  // macOS: не захоплюється screen share
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
    }
  });

  // macOS specific: exclude from screen capture
  overlay.setContentProtection(true);
  ```
- Позиціонування: верхня частина екрану, по центру, або кутовий
- Мінімальний UI: тільки micro-prompt / rescue text / timing
- Реагує на дані з main window через IPC

**IPC Flow:**
```
Main Window (Gemini session running)
  → IPC: 'overlay:update' { microPrompt, rescueText, agentMode, slideTime }
Overlay Window
  → Renders minimal HUD
  → Invisible to screen share
```

**Tray:**
- Іконка в menu bar
- Quick actions: Start Rehearsal / Start Presentation
- Status indicator: connected / session active

#### Electron + Backend Integration
```
Development:
  - Backend: npm run server (port 3001)
  - Frontend: npm run dev (port 3000)
  - Electron: npm run electron:dev (loads localhost:3000)

Production:
  - Backend: bundled, runs as child process from Electron
  - Frontend: built static files, loaded by Electron
  - Single .dmg installer
```

---

## Пріоритет реалізації (для хакатону)

### Must Have (без цього демо не працює)
1. **Backend separation** — виділити Express із vite.config.ts
2. **Projects table + API** — CRUD + file upload
3. **Extended runs** — project_id, per-slide metrics
4. **Risk segments** — агрегація слабких місць
5. **Game plan generation** — JSON plan з risk map
6. **Updated system prompts** — rehearsal з пам'яттю, presentation з game plan
7. **Electron basic** — main window + overlay window
8. **Overlay window** — transparent, always-on-top, screen-share invisible
9. **IPC** — main → overlay data flow

### Should Have (підсилює демо)
10. **GamePlanView** — візуалізація плану перед presentation
11. **New tool calls** — microPrompt, rescueText, agentMode
12. **Presentation file parsing** — PPTX → slides (можна використати python-pptx або mammoth)
13. **Per-slide tracking** — агент відстежує на якому слайді юзер

### Nice to Have (якщо є час)
14. **RunAnalysis** — красивий аналіз рану з порівнянням
15. **Timing strategy** — per-slide time budgets
16. **Tray integration**
17. **Production build** — .dmg packaging

---

## Монорепо структура (ціль)

```
squared/
├── apps/
│   ├── web/                    — React frontend (існуючий src/)
│   │   ├── src/
│   │   │   ├── components/
│   │   │   ├── hooks/
│   │   │   ├── pages/          — НОВЕ: project-centric routing
│   │   │   ├── api/            — НОВЕ: API client
│   │   │   └── types.ts
│   │   ├── index.html
│   │   └── vite.config.ts      — тільки frontend, без Express
│   │
│   ├── server/                 — Express backend
│   │   ├── src/
│   │   │   ├── routes/
│   │   │   ├── db/
│   │   │   ├── services/
│   │   │   └── index.ts
│   │   └── package.json
│   │
│   └── electron/               — Electron shell
│       ├── main.ts
│       ├── overlay.ts
│       ├── preload.ts
│       └── package.json
│
├── packages/
│   └── shared/                 — Shared types
│       ├── types.ts
│       └── package.json
│
├── package.json                — workspace root
├── CLAUDE.md
└── .env.local
```

---

## Ключові технічні рішення

| Рішення | Вибір | Чому |
|---------|-------|------|
| Монорепо tool | npm workspaces | Вже використовується npm, мінімум overhead |
| Backend framework | Express 5 (існуючий) | Вже є, працює |
| DB | SQLite (існуючий) | Файл-based, працює в Electron без серверу |
| Electron | electron-builder | Стандарт для Mac apps |
| PPTX parsing | python-pptx (CLI) або pptx-parser (npm) | Витягнути текст зі слайдів |
| Frontend routing | Simple state (існуючий) | Не додавати React Router для хакатону |
| IPC | Electron IPC | Нативний, швидкий |
| Overlay rendering | Окремий React root в overlay window | Мінімальний bundle, швидкий рендер |

---

## Що НЕ робити для хакатону

- ❌ Не додавати React Router (простий state machine достатньо)
- ❌ Не робити user auth
- ❌ Не робити cloud sync
- ❌ Не робити video recording сесій
- ❌ Не робити post-session PDF reports
- ❌ Не оптимізувати bundle size
- ❌ Не писати тести (хакатон)
- ❌ Не робити auto-update для Electron
- ❌ Не робити production signing для .dmg
