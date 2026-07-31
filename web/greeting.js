/** Session-stable greeting + subtitle picks for the dashboard hero. */

const STORAGE_KEY = "se-labs-greeting-pick";

const GREETINGS = {
  morning: [
    "Good morning",
    "Morning",
    "Bright morning",
    "Hello",
    "Welcome back",
  ],
  afternoon: [
    "Good afternoon",
    "Afternoon",
    "Hello",
    "Welcome back",
    "Good to see you",
  ],
  evening: [
    "Good evening",
    "Evening",
    "Hello",
    "Welcome back",
    "Still at it",
  ],
};

const SUBTITLES = [
  "Here's what needs you today.",
  "Your priorities for today.",
  "A quick look at what's on your plate.",
  "Let's make today count.",
  "Here's your day at a glance.",
];

function timeBucket(hour) {
  if (hour < 12) return "morning";
  if (hour < 17) return "afternoon";
  return "evening";
}

/** Clear stored pick so the next render chooses fresh variants (e.g. on login). */
export function resetSessionGreeting() {
  try {
    sessionStorage.removeItem(STORAGE_KEY);
  } catch {
    /* ignore */
  }
}

function readPick() {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    if (raw) return JSON.parse(raw);
  } catch {
    /* ignore */
  }
  return null;
}

function writePick(pick) {
  try {
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(pick));
  } catch {
    /* ignore */
  }
}

function createPick(hour = new Date().getHours()) {
  const bucket = timeBucket(hour);
  const pool = GREETINGS[bucket];
  const pick = {
    bucket,
    greetingIdx: Math.floor(Math.random() * pool.length),
    subtitleIdx: Math.floor(Math.random() * SUBTITLES.length),
  };
  writePick(pick);
  return pick;
}

/**
 * Greeting line + subtitle, stable for the browser session until reset.
 * @returns {{ greeting: string, subtitle: string }}
 */
export function getSessionGreeting() {
  const pick = readPick() || createPick();
  const pool = GREETINGS[pick.bucket] || GREETINGS[timeBucket(new Date().getHours())];
  const greeting = pool[pick.greetingIdx % pool.length] || pool[0];
  const subtitle = SUBTITLES[pick.subtitleIdx % SUBTITLES.length] || SUBTITLES[0];
  return { greeting, subtitle };
}
