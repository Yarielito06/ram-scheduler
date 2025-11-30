/**
 * Ram The Scheduler Bot
 * Features:
 * - Multi-Tab Navigation (Scheduler, Study)
 * - Real-time Schedule Management (Firestore)
 * - Voice Command Integration (Web Speech API)
 * - Drag-and-Drop Rescheduling (@dnd-kit/core)
 * - Multi-Language Support (EN/ES)
 * - Conversational AI (Small Talk, Nickname personalization)
 * - Study Pomodoro Timer (25m/5m cycles)
 * - Focus History Heatmap (Yearly Contribution Graph)
 */
import React, { useState, useEffect, useRef, useMemo } from 'react';
import { initializeApp } from 'firebase/app';
import { 
  getAuth, 
  signInAnonymously, 
  onAuthStateChanged,
  signInWithCustomToken
} from 'firebase/auth';
import { 
  getFirestore, 
  collection, 
  addDoc, 
  query, 
  onSnapshot, 
  deleteDoc, 
  updateDoc,
  doc,
  serverTimestamp,
  writeBatch,
  getDoc,
  setDoc
} from 'firebase/firestore';
import { 
  DndContext, 
  useDraggable, 
  useDroppable,
  MouseSensor,
  TouchSensor,
  useSensor,
  useSensors
} from '@dnd-kit/core';
import { CSS } from '@dnd-kit/utilities';
import { 
  Send, 
  Calendar as CalendarIcon, 
  Clock, 
  Trash2, 
  Bot, 
  ShieldAlert, 
  LayoutGrid, 
  List,       
  ChevronLeft,
  ChevronRight,
  XCircle,
  Check,
  MoreHorizontal,
  Globe,
  CalendarDays,
  BookOpen, 
  Play,
  Pause,
  RotateCcw,
  Activity,
  Flame,
  Mic, 
  MicOff 
} from 'lucide-react';

// --- Firebase Configuration ---
const userFirebaseConfig = {
    apiKey: "AIzaSyDP4prYijf15dpz4nw2fFpks0cl4eUAOdM",
    authDomain: "ram-bot-6b389.firebaseapp.com",
    projectId: "ram-bot-6b389",
    storageBucket: "ram-bot-6b389.firebasestorage.app",
    messagingSenderId: "933954997766",
    appId: "1:933954997766:web:66b43ce5c8ba7646337d87",
    measurementId: "G-GGBDXVQHC9"
};

const firebaseConfig = typeof __firebase_config !== 'undefined' 
  ? JSON.parse(__firebase_config) 
  : userFirebaseConfig;

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

const rawAppId = typeof __app_id !== 'undefined' ? __app_id : 'ram-production-v1';
const appId = rawAppId.replace(/[^a-zA-Z0-9_-]/g, '_');

// --- Helper: Date & Time Formatting ---
const formatDate = (dateString, locale = 'en-US') => {
  if (!dateString) return '';
  const date = new Date(dateString);
  return date.toLocaleDateString(locale, { 
    weekday: 'short', 
    month: 'short', 
    day: 'numeric' 
  });
};

const formatTime = (timeString, locale = 'en-US') => {
  if (!timeString) return '';
  if (timeString.includes('-') || timeString.includes('to')) return timeString;

  if (timeString.includes(':')) {
    const [hours, minutes] = timeString.split(':');
    const date = new Date();
    date.setHours(parseInt(hours), parseInt(minutes));
    return date.toLocaleTimeString(locale, { hour: 'numeric', minute: '2-digit' });
  }
  return timeString;
};

// --- DRAG & DROP COMPONENTS (Simplified for brevity) ---
function DraggableEvent({ event, isAdmin }) {
  const {attributes, listeners, setNodeRef, transform} = useDraggable({
    id: event.id,
    data: { event } 
  });
  
  const style = transform ? {
    transform: CSS.Translate.toString(transform),
    zIndex: 999, 
    opacity: 0.8,
    cursor: 'grabbing'
  } : { cursor: 'grab' };

  return (
    <div 
      ref={setNodeRef} 
      {...listeners} 
      {...attributes}
      className={`h-2 w-2 rounded-full cursor-grab active:cursor-grabbing transition-colors ${event.hasAskedFollowUp ? 'bg-slate-600' : isAdmin ? 'bg-amber-500' : 'bg-emerald-500 ring-2 ring-transparent hover:ring-emerald-300/50'}`} 
      title={`Drag to reschedule: ${event.title}`}
    />
  );
}

function DroppableDay({ day, month, year, children, onSelect }) {
  const dateId = `day-${year}-${month}-${day}`;
  const {isOver, setNodeRef} = useDroppable({
    id: dateId,
    data: { day, month, year } 
  });

  const isToday = new Date().getDate() === day && new Date().getMonth() === month && new Date().getFullYear() === year;

  return (
    <button 
      ref={setNodeRef}
      onClick={() => onSelect(day)}
      className={`relative bg-slate-900/50 border rounded-lg p-2 flex flex-col items-start transition-all text-left focus:outline-none focus:ring-1 focus:ring-emerald-500/50
        ${isOver ? 'bg-emerald-900/40 border-emerald-500 scale-[1.02] shadow-lg shadow-emerald-900/20' : isToday ? 'border-emerald-500/50 bg-emerald-900/10' : 'border-slate-800 hover:bg-slate-800'}
      `}
    >
      <span className={`text-xs font-bold mb-1 ${isToday ? 'text-emerald-400' : 'text-slate-400'}`}>{day}</span>
      <div className="flex flex-wrap gap-1 content-start overflow-hidden w-full h-full min-h-[20px]">
        {children}
      </div>
    </button>
  );
}

// Helper: Determine color based on study intensity
const getColor = (minutes) => {
    if (!minutes || minutes === 0) return 'bg-slate-800'; 
    if (minutes < 30) return 'bg-emerald-900';
    if (minutes < 60) return 'bg-emerald-700';
    if (minutes < 120) return 'bg-emerald-500';
    return 'bg-emerald-400 shadow-[0_0_8px_rgba(52,211,153,0.8)]';
};

// Helper: Formats minutes into HH:MM string
const formatMinutes = (minutes) => {
    const h = Math.floor(minutes / 60);
    const m = minutes % 60;
    return h > 0 ? `${h}h ${m}m` : `${m}m`;
};


// --- YEAR VIEW (Original 365-Day Grid/Heatmap) ---
function YearView({ grid, language, currentYear, setCurrentYear }) {
    const today = new Date();
    
    // Generate Month Labels
    const monthLabels = useMemo(() => {
        const labels = [];
        let currentMonth = -1;
        grid.forEach((week, i) => {
            if (week.length > 0 && week[0] && week[0].date.getMonth() !== currentMonth) {
                currentMonth = week[0].date.getMonth();
                labels.push({ 
                    weekIndex: i, 
                    label: week[0].date.toLocaleDateString(language, { month: 'short' }) 
                });
            }
        });
        return labels;
    }, [grid, language]);


    return (
        <div className="w-full flex flex-col items-center">
             {/* Year Selector */}
            <div className="flex items-center justify-center w-full mb-3 text-sm">
                <button onClick={() => setCurrentYear(cy => cy - 1)} className="p-1 hover:bg-slate-800 rounded-full text-slate-400"><ChevronLeft size={16} /></button>
                <span className="font-mono text-slate-200 mx-3">{currentYear}</span>
                <button 
                    onClick={() => setCurrentYear(cy => cy + 1)} 
                    disabled={currentYear >= today.getFullYear()}
                    className={`p-1 rounded-full ${currentYear >= today.getFullYear() ? 'text-slate-600 cursor-not-allowed' : 'hover:bg-slate-800 text-slate-400'}`}
                ><ChevronRight size={16} /></button>
            </div>

            <div className="w-full overflow-x-auto pb-4 custom-scrollbar">
                <div className="min-w-max pr-4 flex flex-col">
                    
                    {/* Month Labels (Horizontal Alignment) */}
                    <div className="flex text-[10px] text-slate-500 mb-1 ml-[25px] relative h-4"> 
                        {monthLabels.map(m => (
                            <span 
                                key={m.label + m.weekIndex}
                                className="absolute"
                                // Adjust position based on week index (16px approx is width + gap for a cell)
                                style={{ transform: `translateX(calc(${m.weekIndex} * 16px))` }} 
                            >
                                {m.label}
                            </span>
                        ))}
                    </div>

                    <div className="flex gap-[3px] mt-4">
                        {/* Day Labels (Vertical) */}
                        <div className="flex flex-col gap-[3px] mr-2 text-[9px] text-slate-600 font-mono pt-[1px] select-none">
                            <span className="h-3">Sun</span>
                            <span className="h-3">Mon</span>
                            <span className="h-3">Tue</span>
                            <span className="h-3">Wed</span>
                            <span className="h-3">Thu</span>
                            <span className="h-3">Fri</span>
                            <span className="h-3">Sat</span>
                        </div>
                        {/* The Grid (Weeks as Columns) */}
                        {grid.map((week, i) => (
                            <div key={`${i}-${currentYear}`} className="flex flex-col gap-[3px]">
                                {week.map((day, j) => {
                                    const uniqueKey = day ? `${day.dateKey}-${i}-${j}` : `empty-${i}-${j}`; 
                                    
                                    if (!day || day.isOutOfRange || day.isFuture) return <div key={uniqueKey} className="w-3 h-3 bg-slate-900/30" />;
                                    
                                    return (
                                        <div 
                                            key={uniqueKey}
                                            title={`${day.date.toDateString()}: ${day.minutes} mins of focus`}
                                            className={`w-3 h-3 rounded-[2px] transition-all cursor-help
                                                ${getColor(day.minutes)}`}
                                        />
                                    );
                                })}
                            </div>
                        ))}
                    </div>
                </div>
            </div>
             {/* Legend */}
            <div className="flex items-center justify-end gap-2 mt-3 text-[9px] w-full text-slate-500 font-mono tracking-tight">
                <span>Less</span>
                <div className="flex gap-[2px]">
                    <div className="w-3 h-3 rounded-[2px] bg-slate-800"></div>
                    <div className="w-3 h-3 rounded-[2px] bg-emerald-900"></div>
                    <div className="w-3 h-3 rounded-[2px] bg-emerald-700"></div>
                    <div className="w-3 h-3 rounded-[2px] bg-emerald-500"></div>
                    <div className="w-3 h-3 rounded-[2px] bg-emerald-400"></div>
                </div>
                <span>More</span>
            </div>
        </div>
    );
}

// --- MAIN HEATMAP SWITCHER ---
function FocusHeatmap({ logs, focusYear, setCurrentYear, language }) {
    const today = new Date();
    
    // We force Year view since it's the only option now
    const currentYear = focusYear;
    
    const getRangeProps = (range) => {
        // Default to Year
        const startOfYear = new Date(currentYear, 0, 1);
        const endOfYear = new Date(currentYear + 1, 0, 0);
        const daysInYear = (endOfYear - startOfYear) / (1000 * 60 * 60 * 24);
        return { weeks: Math.ceil(daysInYear / 7) };
    };
    
    const { weeks: weeksToDisplay } = getRangeProps('year');
    
    const grid = useMemo(() => {
        let gridData = [];
        let startDate = new Date(currentYear, 0, 1); // Start on Jan 1st of the selected year

        const dayOfWeek = startDate.getDay();
        startDate.setDate(startDate.getDate() - dayOfWeek); // Adjust to previous Sunday

        for (let w = 0; w <= weeksToDisplay; w++) {
            const week = [];
            for (let d = 0; d < 7; d++) {
                const currentDay = new Date(startDate);
                currentDay.setDate(startDate.getDate() + (w * 7) + d);
                
                const dateKey = currentDay.toISOString().split('T')[0];
                const minutes = logs[dateKey] || 0;
                let isFuture = currentDay > today && currentDay.getFullYear() === today.getFullYear();
                let isOutOfRange = currentDay.getFullYear() !== currentYear; // Check if outside selected year

                if (currentDay.getFullYear() !== currentYear && currentDay < new Date(currentYear, 0, 1)) {
                    week.push(null); // Exclude fillers from Dec of previous year
                    continue;
                }
                if (currentDay.getFullYear() !== currentYear && currentDay > new Date(currentYear, 11, 31)) {
                    week.push(null); // Exclude days of the next year
                    continue;
                }


                week.push({ date: currentDay, minutes, dateKey, isFuture, isOutOfRange });
            }
            gridData.push(week);
        }
        
        // Filter out empty trailing weeks if necessary (optional clean up)
        while (gridData.length > 0 && gridData[gridData.length - 1].every(day => !day || day.isOutOfRange || day.isFuture)) {
            gridData.pop();
        }

        return gridData;
    }, [logs, currentYear]);


    return <YearView grid={grid} language={language} currentYear={currentYear} setCurrentYear={setCurrentYear} />;
}


// --- The Brain: Logic Parser (Same as previous version) ---
const parseCommand = (text, manualDateOverride = null) => {
  const lowerText = text.toLowerCase();
  
  if (lowerText.includes('ram sudo mode')) return { isCommand: true, command: 'ACTIVATE_ADMIN', originalText: text };
  if (lowerText.includes('ram exit sudo')) return { isCommand: true, command: 'DEACTIVATE_ADMIN', originalText: text };
  if (lowerText.includes('ram nuke database')) return { isCommand: true, command: 'NUKE_DB', originalText: text };

  if (lowerText.startsWith("call me") || lowerText.startsWith("my name is") || lowerText.startsWith("llámame") || lowerText.startsWith("mi nombre es")) {
      let name = text.replace(/call me|my name is|llámame|mi nombre es/gi, '').trim();
      name = name.replace(/[.,!]/g, '');
      if (name.length > 0) {
          return { isConversation: true, type: 'SET_NICKNAME', name: name, originalText: text };
      }
  }

  const greetings = ['hi', 'hello', 'hey', 'hola', 'buenas', 'yo', 'sup', 'greetings'];
  const helpRequests = ['help', 'ayuda', 'what can you do', 'que puedes hacer', 'guide'];
  const statusChecks = ['how are you', 'como estas', 'what\'s up', 'que tal'];
  const gratitude = ['thanks', 'thank you', 'gracias', 'thx'];

  if (greetings.some(g => lowerText.includes(g)) && !/\d/.test(lowerText) && !lowerText.includes('meet') && !lowerText.includes('gym')) {
      return { isConversation: true, type: 'GREETING', originalText: text };
  }
  if (helpRequests.some(h => lowerText.includes(h))) {
      return { isConversation: true, type: 'HELP', originalText: text };
  }
  if (statusChecks.some(s => lowerText.includes(s))) {
      return { isConversation: true, type: 'STATUS', originalText: text };
  }
  if (gratitude.some(g => lowerText.includes(g))) {
      return { isConversation: true, type: 'GRATITUDE', originalText: text };
  }

  const timeRangeRegex = /(\d{1,2}(:\d{2})?\s?(am|pm))\s*(?:-|to|a)\s*(\d{1,2}(:\d{2})?\s?(am|pm))/i;
  const timeRangeMatch = lowerText.match(timeRangeRegex);
  const timeRegex = /(\d{1,2}(:\d{2})?\s?(am|pm)|(\d{1,2}:\d{2})|a las \d{1,2})/i;
  const timeMatch = lowerText.match(timeRegex);

  const daysMap = { 
      sun: 0, mon: 1, tue: 2, wed: 3, thu: 4, fri: 5, sat: 6,
      dom: 0, lun: 1, mar: 2, mie: 3, jue: 4, vie: 5, sab: 6 
  };
  
  let recurringDays = [];
  let isRecurring = false;

  const rangeRecurRegex = /(?:every|cada|todos los)\s+([a-z]{3,})\s+(?:to|through|-|a|hasta)\s+([a-z]{3,})/i;
  const rangeMatch = lowerText.match(rangeRecurRegex);
  const singleRecurRegex = /(?:every|cada|todos los)\s+([a-z]{3,})|([a-z]{3,})s\b/i;
  const singleMatch = lowerText.match(singleRecurRegex);

  if (rangeMatch) {
    const startDay = daysMap[rangeMatch[1].substring(0, 3)];
    const endDay = daysMap[rangeMatch[2].substring(0, 3)];
    if (startDay !== undefined && endDay !== undefined) {
        isRecurring = true;
        let current = startDay;
        while (current !== endDay) {
            recurringDays.push(current);
            current = (current + 1) % 7;
        }
        recurringDays.push(endDay);
    }
  } else if (singleMatch) {
    const dayName = singleMatch[1] || singleMatch[2];
    const dayIndex = daysMap[dayName.substring(0, 3)];
    if (dayIndex !== undefined) {
        isRecurring = true;
        recurringDays.push(dayIndex);
    }
  }

  const months = { 
      jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11,
      ene: 0, abr: 3, ago: 7, dic: 11
  };
  
  let dateObj = new Date();
  let dateFound = false;
  let matchedDateString = '';

  if (manualDateOverride) {
      dateObj = new Date(manualDateOverride);
      dateFound = true;
  } 
  else if (lowerText.includes('tomorrow') || lowerText.includes('mañana')) {
    dateObj.setDate(dateObj.getDate() + 1);
    dateFound = true;
  } else if (lowerText.includes('today') || lowerText.includes('hoy')) {
    dateFound = true;
  } else {
    const dayMonthRegex = /(?:the|el)?\s*(\d{1,2})(?:st|nd|rd|th|er|o)?\s+(?:(?:of|de)\s+)?([a-z]{3,})/i; 
    const monthDayRegex = /([a-z]{3,})\s+(?:the|el)?\s*(\d{1,2})(?:st|nd|rd|th|er|o)?/i;
    const slashDateRegex = /(\d{1,2})[/-](\d{1,2})/i;
    const monthContextRegex = /\b(?:in|for|starting|from|en|para|desde)\s+([a-z]{3,})/i;

    const matchA = lowerText.match(dayMonthRegex);
    if (matchA && months.hasOwnProperty(matchA[2].substring(0,3))) {
            dateObj.setMonth(months[matchA[2].substring(0,3)]); 
            dateObj.setDate(parseInt(matchA[1])); 
            dateFound = true; 
            matchedDateString = matchA[0];
    } else if (!dateFound) { 
        const matchB = lowerText.match(monthDayRegex);
        if (matchB && months.hasOwnProperty(matchB[1].substring(0,3))) {
            dateObj.setMonth(months[matchB[1].substring(0,3)]); 
            dateObj.setDate(parseInt(matchB[2])); 
            dateFound = true; 
            matchedDateString = matchB[0];
        }
    }

    if (!dateFound) {
        const matchC = lowerText.match(slashDateRegex);
        if (matchC) {
            dateObj.setDate(parseInt(matchC[1])); 
            dateObj.setMonth(parseInt(matchC[2])-1); 
            matchedDateString = matchC[0];
        }
    }

    if (!dateFound) {
        const matchMonth = lowerText.match(monthContextRegex);
        if (matchMonth && months.hasOwnProperty(matchMonth[1].substring(0,3))) {
            dateObj.setDate(1); 
            dateObj.setMonth(months[matchMonth[1].substring(0,3)]);
            dateFound = true;
        }
    }

    if (dateFound) {
        const now = new Date();
        const check = new Date(dateObj);
        now.setHours(0,0,0,0); check.setHours(0,0,0,0);
        if (check < now) dateObj.setFullYear(now.getFullYear() + 1);
    }
  }

  let timeStr = 'All Day';
  let sortTimeObj = new Date(dateObj); 

  if (manualDateOverride && manualDateOverride.includes('T')) {
      timeStr = dateObj.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      sortTimeObj = dateObj;
  } else {
      if (timeRangeMatch) {
          timeStr = timeRangeMatch[0];
          const [start, end] = timeRangeMatch[0].split(/-|to|a/);
          const startMatch = start.match(timeRegex);
          if (startMatch) applyTimeToDate(sortTimeObj, startMatch);
      } else if (timeMatch) {
          timeStr = timeMatch[0];
          applyTimeToDate(sortTimeObj, timeMatch);
      }
  }

  function applyTimeToDate(d, match) {
    let cleanTime = match[0].replace(/a las|las/i, '').trim(); 
    let [timePart, modifier] = cleanTime.split(/(am|pm)/i);
    let [hours, minutes] = timePart.trim().split(':');
    if (!minutes) minutes = '00';
    let hourInt = parseInt(hours);
    
    if (modifier && modifier.toLowerCase() === 'pm' && hourInt < 12) hourInt += 12;
    if (modifier && modifier.toLowerCase() === 'am' && hourInt === 12) hourInt = 0;
    if (!modifier && hourInt < 8 && hourInt !== 0) hourInt += 12;

    d.setHours(hourInt, parseInt(minutes), 0, 0);
  }

  let activity = text;
  if (timeRangeMatch) activity = activity.replace(timeRangeMatch[0], '');
  else if (timeMatch) activity = activity.replace(timeMatch[0], '');
  
  if (matchedDateString) activity = activity.replace(matchedDateString, '');
  if (rangeMatch) activity = activity.replace(rangeMatch[0], '');
  else if (singleMatch) activity = activity.replace(singleMatch[0], '');

  activity = activity
    .replace(/tomorrow|today|mañana|hoy/gi, '')
    .replace(/\b(schedule|add|create|remind|put|book|set|make)\b/gi, '')
    .replace(/\b(ey+|hello|hi|yo|how are you|how is it going|how you doing|hope you are good)\b/gi, '')
    .replace(/\b(can you|could you|would you|please|plz|thanks|thank you|kindly)\b/gi, '')
    .replace(/\b(man|bro|dude|mate|buddy|pal|miss|sir|madam|boss)\b/gi, '') 
    .replace(/\b(do|doing|have|get|take|perform|arrange)\b/gi, '') 
    .replace(/\b(at|in|on|of|from|starting|for|the|a|an)\b/gi, ' ')
    .replace(/\b(agendar|agenda|crear|recordar|pon|poner|hacer|reservar)\b/gi, '') 
    .replace(/\b(hola|ey|buenas|que tal|como estas)\b/gi, '') 
    .replace(/\b(por favor|gracias|puedes|podrias)\b/gi, '') 
    .replace(/\b(tio|amigo|jefe|colega|hombre|mujer)\b/gi, '') 
    .replace(/\b(tengo|hay|hacer|tener|ir)\b/gi, '') 
    .replace(/\b(en|el|la|los|las|de|del|para|por|un|una)\b/gi, ' ') 
    .replace(/[;,\.\?\!]/g, '')
    .replace(/\s+/g, ' ')
    .trim();

  if (activity.length === 0) activity = "Meeting"; 
  activity = activity.charAt(0).toUpperCase() + activity.slice(1);

  return {
    isValid: (timeMatch || dateFound || isRecurring),
    activity: activity,
    time: timeStr,
    date: sortTimeObj.toISOString(),
    hours: sortTimeObj.getHours(),
    minutes: sortTimeObj.getMinutes(),
    isRecurring,
    recurringDays,
    originalText: text
  };
};

export default function App() {
  const [user, setUser] = useState(null);
  const [activeTab, setActiveTab] = useState('schedule');
  const [input, setInput] = useState('');
  const [messages, setMessages] = useState([]); 
  const [events, setEvents] = useState([]);
  const [loading, setLoading] = useState(true);
  const [permission, setPermission] = useState('default');
  const [isListening, setIsListening] = useState(false);
  const [isAdmin, setIsAdmin] = useState(false); 
  const bottomRef = useRef(null);
  const [language, setLanguage] = useState('en-US'); 
  const [isConfirming, setIsConfirming] = useState(false);
  const silenceTimer = useRef(null);
  const previousInputRef = useRef(''); 
  const [viewMode, setViewMode] = useState('list'); 
  const [currentDate, setCurrentDate] = useState(new Date());
  const [selectedDay, setSelectedDay] = useState(null); 
  const [pickerDate, setPickerDate] = useState(''); 
  const dateInputRef = useRef(null);
  const [nickname, setNickname] = useState(null); 

  // Study Timer States
  const [timeLeft, setTimeLeft] = useState(25 * 60); 
  const [isTimerRunning, setIsTimerRunning] = useState(false);
  const [studyMode, setStudyMode] = useState('focus'); 
  const [sessionsCompleted, setSessionsCompleted] = useState(0);
  const [focusLogs, setFocusLogs] = useState({}); 
  const [focusYear, setFocusYear] = useState(new Date().getFullYear()); // Year selector

  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 8 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 200, tolerance: 5 } })
  );

  useEffect(() => {
    const initAuth = async () => {
      try {
        if (typeof __initial_auth_token !== 'undefined' && __initial_auth_token) {
          await signInWithCustomToken(auth, __initial_auth_token);
        } else {
          await signInAnonymously(auth);
        }
      } catch (error) { console.error("Authentication Error:", error); }
    };
    initAuth();
    const unsubscribe = onAuthStateChanged(auth, async (u) => { 
        setUser(u); 
        setLoading(false);
        if (u) {
            const userRef = doc(db, 'artifacts', appId, 'users', u.uid, 'profile', 'info');
            try {
                const docSnap = await getDoc(userRef);
                if (docSnap.exists() && docSnap.data().nickname) {
                    setNickname(docSnap.data().nickname);
                    setMessages([{ id: 'intro', sender: 'ram', text: `Welcome back, ${docSnap.data().nickname}!` }]);
                } else {
                    setMessages([{ id: 'intro', sender: 'ram', text: "Hello! I'm Ram v23.0. Enjoy the responsive design!" }]);
                }
            } catch (e) { console.log(e); }
        }
    });
    if ('Notification' in window) setPermission(Notification.permission);
    return () => unsubscribe();
  }, []);

  // Events Sync
  useEffect(() => {
    if (!user) return;
    const q = collection(db, 'artifacts', appId, 'users', user.uid, 'schedule');
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const fetchedEvents = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      fetchedEvents.sort((a, b) => new Date(a.date) - new Date(b.date));
      setEvents(fetchedEvents);
    }, (error) => console.error("Error fetching schedule:", error));
    return () => unsubscribe();
  }, [user]);

  // Focus Logs Sync
  useEffect(() => {
      if (!user) return;
      const q = collection(db, 'artifacts', appId, 'users', user.uid, 'focus_logs');
      const unsubscribe = onSnapshot(q, (snapshot) => {
          const logs = {};
          snapshot.docs.forEach(doc => {
              const data = doc.data();
              const dayKey = data.date; 
              logs[dayKey] = (logs[dayKey] || 0) + data.minutes;
          });
          setFocusLogs(logs);
      });
      return () => unsubscribe();
  }, [user]);

  // Study Timer Logic
  useEffect(() => {
      let interval = null;
      if (isTimerRunning && timeLeft > 0) {
          interval = setInterval(() => {
              setTimeLeft((prev) => prev - 1);
          }, 1000);
      } else if (timeLeft === 0 && isTimerRunning) {
          setIsTimerRunning(false);
          if (studyMode === 'focus') {
              setSessionsCompleted(s => s + 1);
              if (permission === 'granted') new Notification("Ram Focus", { body: "Great job! Time for a break." });
              alert("Focus session complete! Take a break.");
              
              if (user) {
                  const today = new Date().toISOString().split('T')[0];
                  addDoc(collection(db, 'artifacts', appId, 'users', user.uid, 'focus_logs'), {
                      date: today,
                      minutes: 25,
                      timestamp: serverTimestamp()
                  });
              }

              setStudyMode('break');
              setTimeLeft(5 * 60); 
          } else {
              if (permission === 'granted') new Notification("Ram Focus", { body: "Break over! Back to work." });
              alert("Break over! Ready to focus?");
              setStudyMode('focus');
              setTimeLeft(25 * 60);
          }
      }
      return () => clearInterval(interval);
  }, [isTimerRunning, timeLeft, studyMode, permission, user]);

  const handleDragEnd = async (event) => {
      const { active, over } = event;
      if (over && active.id !== over.id) {
          const draggedEvent = active.data.current.event;
          const target = over.data.current;
          if (!target || !draggedEvent) return;
          const originalDate = new Date(draggedEvent.date);
          const newDate = new Date(target.year, target.month, target.day);
          newDate.setHours(originalDate.getHours());
          newDate.setMinutes(originalDate.getMinutes());
          const msg = language.startsWith('es') 
            ? `🔄 He movido "${draggedEvent.title}" al ${newDate.toLocaleDateString('es-ES')}.`
            : `🔄 I moved "${draggedEvent.title}" to ${newDate.toLocaleDateString()}.`;
          setMessages(prev => [...prev, { id: Date.now(), sender: 'ram', text: msg }]);
          try {
              const eventRef = doc(db, 'artifacts', appId, 'users', user.uid, 'schedule', draggedEvent.id);
              await updateDoc(eventRef, { date: newDate.toISOString() });
          } catch (err) { console.error("Reschedule failed", err); }
      }
  };

  const handleSend = async (e, forcedInput = null) => {
    if (e) e.preventDefault();
    const textToSend = forcedInput || input;
    setIsConfirming(false);
    
    if (!textToSend.trim() || !user) return;

    const userMsg = { id: Date.now(), sender: 'user', text: textToSend };
    setMessages(prev => [...prev, userMsg]);
    setInput('');
    setPickerDate('');

    const analysis = parseCommand(userMsg.text, pickerDate);

    if (analysis.isCommand) {
        if (analysis.command === 'ACTIVATE_ADMIN') { setIsAdmin(true); return; }
        if (analysis.command === 'DEACTIVATE_ADMIN') { setIsAdmin(false); return; }
        if (analysis.command === 'NUKE_DB' && isAdmin) {
             const batch = writeBatch(db);
             events.forEach(ev => batch.delete(doc(db, 'artifacts', appId, 'users', user.uid, 'schedule', ev.id)));
             await batch.commit();
             return;
        }
    }

    if (analysis.isConversation) {
        setTimeout(async () => {
            let reply = "";
            if (analysis.type === 'SET_NICKNAME') {
                const newName = analysis.name.charAt(0).toUpperCase() + analysis.name.slice(1);
                setNickname(newName);
                reply = language.startsWith('es') ? `¡Entendido! Te llamaré ${newName}.` : `Got it! I'll call you ${newName}.`;
                try {
                    const userRef = doc(db, 'artifacts', appId, 'users', user.uid, 'profile', 'info');
                    await setDoc(userRef, { nickname: newName }, { merge: true });
                } catch (err) {}
            } else if (analysis.type === 'GREETING') {
                const nameStr = nickname ? ` ${nickname}` : '';
                reply = language.startsWith('es') 
                    ? `¡Hola${nameStr}! ¿Qué tal? ¿En qué te ayudo?` 
                    : `Hey${nameStr}! Good to see you. What's on the agenda?`;
            } else if (analysis.type === 'HELP') {
                reply = language.startsWith('es') ? "Soy Ram. Puedo agendar eventos y ayudarte a estudiar." : "I'm Ram. I can book meetings or help you study.";
            } else if (analysis.type === 'STATUS') {
                reply = language.startsWith('es') ? "Todo perfecto por aquí. ¿Y tú?" : "I'm feeling productive! How about you?";
            } else if (analysis.type === 'GRATITUDE') {
                reply = language.startsWith('es') ? "¡Un placer!" : "Anytime!";
            }
            setMessages(prev => [...prev, { id: Date.now() + 1, sender: 'ram', text: reply }]);
        }, 500);
        return;
    }

    setTimeout(async () => {
      if (analysis.isValid) {
        try {
          const batch = writeBatch(db);
          const scheduleRef = collection(db, 'artifacts', appId, 'users', user.uid, 'schedule');
          let responseText = "";

          if (analysis.isRecurring) {
              const weeksToSchedule = 4;
              const startDate = new Date(analysis.date);
              startDate.setHours(0,0,0,0);
              for (let w = 0; w < weeksToSchedule; w++) {
                  analysis.recurringDays.forEach(dayIndex => {
                      let baseDate = new Date(startDate);
                      baseDate.setDate(startDate.getDate() + (w * 7));
                      let currentDay = baseDate.getDay();
                      let distance = (dayIndex + 7 - currentDay) % 7;
                      let targetDate = new Date(baseDate);
                      targetDate.setDate(baseDate.getDate() + distance);
                      targetDate.setHours(analysis.hours, analysis.minutes, 0, 0);
                      const newDocRef = doc(scheduleRef);
                      batch.set(newDocRef, {
                          title: analysis.activity,
                          time: analysis.time,
                          date: targetDate.toISOString(),
                          hasAskedFollowUp: false,
                          isRecurringInstance: true,
                          createdAt: serverTimestamp()
                      });
                  });
              }
              await batch.commit();
              responseText = `Got it. Recurring schedule set.`;
          } else {
              await addDoc(scheduleRef, {
                title: analysis.activity,
                time: analysis.time,
                date: analysis.date,
                hasAskedFollowUp: false,
                createdAt: serverTimestamp()
              });
              responseText = language.startsWith('es')
                ? `Agendado "${analysis.activity}" para el ${formatDate(analysis.date, 'es-ES')} a las ${analysis.time}.`
                : `Scheduled "${analysis.activity}" for ${formatDate(analysis.date)} at ${analysis.time}.`;
          }
          setMessages(prev => [...prev, { id: Date.now() + 1, sender: 'ram', text: responseText }]);
        } catch (err) { console.error(err); }
      } else {
        const errorMsg = language.startsWith('es')
            ? "No entendí. Usa el icono 📅."
            : "I didn't catch that. Use the 📅 icon.";
        setMessages(prev => [...prev, { id: Date.now() + 1, sender: 'ram', text: errorMsg }]);
      }
    }, 600);
  };

  const startConfirmationListening = () => {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) return;
    const recognition = new SpeechRecognition();
    recognition.continuous = false; recognition.lang = language; recognition.interimResults = false;
    recognition.onresult = (e) => {
        const t = e.results[0][0].transcript.toLowerCase();
        if (t.includes('yes') || t.includes('send') || t.includes('si') || t.includes('claro')) handleSend(null);
        else cancelConfirmation();
    };
    recognition.start();
  };

  const startListening = () => {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) { alert("Use Chrome/Safari."); return; }
    if (input.trim().length > 0) previousInputRef.current = input.trim() + " "; else previousInputRef.current = "";
    setIsConfirming(false);
    const recognition = new SpeechRecognition();
    recognition.continuous = true; recognition.interimResults = true; recognition.lang = language; 
    recognition.onstart = () => setIsListening(true);
    recognition.onend = () => { if (!isConfirming) setIsListening(false); };
    recognition.onresult = (e) => {
        const t = Array.from(e.results).map(r => r[0].transcript).join('');
        setInput(previousInputRef.current + t);
        if (silenceTimer.current) clearTimeout(silenceTimer.current);
        silenceTimer.current = setTimeout(() => {
            recognition.stop(); setIsListening(false); setIsConfirming(true);
            if ('speechSynthesis' in window) {
                const text = language.startsWith('es') ? "¿Has terminado?" : "Are you finished?";
                const u = new SpeechSynthesisUtterance(text); u.lang = language; 
                u.onend = () => startConfirmationListening(); window.speechSynthesis.speak(u);
            }
        }, 3000); 
    };
    recognition.start();
  };

  const cancelConfirmation = () => startListening();
  const requestNotification = async () => { if ('Notification' in window) setPermission(await Notification.requestPermission()); };
  const handleDelete = async (eventId) => { if (user) try { await deleteDoc(doc(db, 'artifacts', appId, 'users', user.uid, 'schedule', eventId)); } catch (e) {} };

  const daysInMonth = new Date(currentDate.getFullYear(), currentDate.getMonth() + 1, 0).getDate();
  const firstDayOfMonth = new Date(currentDate.getFullYear(), currentDate.getMonth(), 1).getDay(); 
  const prevMonth = () => { setSelectedDay(null); setCurrentDate(new Date(currentDate.getFullYear(), currentDate.getMonth() - 1, 1)); };
  const nextMonth = () => { setSelectedDay(null); setCurrentDate(new Date(currentDate.getFullYear(), currentDate.getMonth() + 1, 1)); };
  const getEventsForDay = (day) => events.filter(e => {
      const d = new Date(e.date);
      return d.getDate() === day && d.getMonth() === currentDate.getMonth() && d.getFullYear() === currentDate.getFullYear();
  });

  const formatTimer = (seconds) => {
      const m = Math.floor(seconds / 60);
      const s = seconds % 60;
      return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  };

  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [messages, isConfirming]);

  if (loading) return <div className="h-screen flex items-center justify-center bg-slate-950 text-emerald-400 font-mono">Booting RamOS...</div>;

  return (
    <div className="flex h-screen bg-slate-950 text-slate-200 font-sans overflow-hidden selection:bg-emerald-500/30">
      
      {/* SIDEBAR */}
      <div className="hidden md:flex flex-col w-20 border-r border-slate-800 items-center py-6 gap-6 bg-slate-900/30">
          <div className="p-2 bg-emerald-500/20 rounded-xl mb-4">
              <Bot size={28} className="text-emerald-400" />
          </div>
          <button onClick={() => setActiveTab('schedule')} className={`p-3 rounded-xl transition-all ${activeTab === 'schedule' ? 'bg-slate-800 text-emerald-400 shadow-lg shadow-emerald-900/20' : 'text-slate-500 hover:text-slate-300 hover:bg-slate-800/50'}`} title="Scheduler"><CalendarIcon size={24} /></button>
          <button onClick={() => setActiveTab('study')} className={`p-3 rounded-xl transition-all ${activeTab === 'study' ? 'bg-slate-800 text-emerald-400 shadow-lg shadow-emerald-900/20' : 'text-slate-500 hover:text-slate-300 hover:bg-slate-800/50'}`} title="Study Mode"><BookOpen size={24} /></button>
      </div>

      <div className="flex-1 flex flex-col md:flex-row h-full overflow-hidden">
        
        {/* SCHEDULE TAB */}
        {activeTab === 'schedule' && (
            <>
                {/* CHAT AREA */}
                <div className="flex-1 flex flex-col border-r border-slate-800 h-[60vh] md:h-full relative">
                    <div className={`p-4 border-b border-slate-800 ${isAdmin ? 'bg-amber-900/20' : 'bg-slate-900/50'} flex items-center justify-between backdrop-blur-sm z-10 transition-colors duration-500`}>
                        <div className="flex items-center gap-2 md:hidden"><Bot size={24} className="text-emerald-400" /><h1 className="font-bold text-slate-100">Ram</h1></div>
                        <div className="hidden md:block"><h1 className="font-bold text-slate-100">{isAdmin ? 'Ram [ADMIN]' : 'Ram Assistant'}</h1></div>
                        <div className="flex items-center gap-2">
                            <button onClick={() => setLanguage(l => l === 'en-US' ? 'es-ES' : 'en-US')} className="p-2 bg-slate-800 hover:bg-slate-700 rounded-lg text-slate-400 hover:text-emerald-400 transition-all flex items-center gap-1 text-xs font-bold">
                                <Globe size={16} /> {language === 'en-US' ? 'EN' : 'ES'}
                            </button>
                        </div>
                    </div>

                    <div className="flex-1 overflow-y-auto p-4 space-y-4">
                        {messages.map((msg) => (
                            <div key={msg.id} className={`flex ${msg.sender === 'user' ? 'justify-end' : 'justify-start'}`}>
                                <div className={`max-w-[85%] rounded-2xl px-4 py-3 text-sm shadow-sm ${msg.sender === 'user' ? 'bg-emerald-600 text-white rounded-br-none' : msg.isFollowUp ? 'bg-emerald-900/40 border border-emerald-500/30 text-emerald-100 rounded-bl-none' : 'bg-slate-800 text-slate-200 rounded-bl-none border border-slate-700'}`}>
                                    {msg.isFollowUp && <Bot size={16} className="mb-2 text-emerald-400" />}
                                    {msg.text}
                                </div>
                            </div>
                        ))}
                        <div ref={bottomRef} />
                    </div>

                    {isConfirming && (
                        <div className="mx-4 mb-4 p-4 bg-slate-800 border border-emerald-500/50 rounded-xl animate-in slide-in-from-bottom-5 shadow-lg">
                            <p className="text-sm text-emerald-400 font-semibold mb-2 flex items-center gap-2"><Bot size={16} /> {language.startsWith('es') ? 'Escuché:' : 'I heard:'}</p>
                            <p className="text-slate-200 italic mb-4">"{input}"</p>
                            <div className="flex gap-2 justify-end">
                                <button onClick={cancelConfirmation} className="px-3 py-1.5 text-xs bg-slate-700 hover:bg-slate-600 rounded-lg text-slate-200 flex items-center gap-1"><MoreHorizontal size={14} /> No</button>
                                <button onClick={(e) => handleSend(e)} className="px-3 py-1.5 text-xs bg-emerald-600 hover:bg-emerald-500 rounded-lg text-white flex items-center gap-1"><Check size={14} /> Yes</button>
                            </div>
                        </div>
                    )}

                    <div className="p-4 bg-slate-900 border-t border-slate-800">
                        <div className="flex items-center gap-2">
                            <button onClick={startListening} className={`p-3 rounded-xl transition-all ${isListening ? 'bg-red-500/20 text-red-500 animate-pulse ring-2 ring-red-500/50' : 'bg-slate-800 text-slate-400 hover:bg-slate-700 hover:text-emerald-400'}`}>
                                {isListening ? <MicOff size={20} /> : <Mic size={20} />}
                            </button>
                            <div className="relative group">
                                <input type="datetime-local" ref={dateInputRef} className="absolute inset-0 opacity-0 cursor-pointer w-full h-full z-10" onChange={(e) => setPickerDate(e.target.value)} />
                                <button className={`p-3 rounded-xl transition-all duration-300 ${pickerDate ? 'text-emerald-400 bg-emerald-400/10 ring-1 ring-emerald-400/50' : 'bg-slate-800 text-slate-400 group-hover:bg-slate-700 group-hover:text-emerald-400'}`}><CalendarDays size={20} /></button>
                            </div>
                            <form onSubmit={handleSend} className="flex-1 relative">
                                <input type="text" value={input} onChange={(e) => setInput(e.target.value)} placeholder={pickerDate ? (language.startsWith('es') ? `Fecha lista. ¿Evento?` : "Date set. Event?") : (language.startsWith('es') ? "Escribe..." : "Type...")} className={`w-full text-slate-200 pl-4 pr-12 py-3 rounded-xl border focus:outline-none focus:ring-2 transition-all placeholder:text-slate-500 ${isAdmin ? 'bg-amber-900/10 border-amber-900/50 focus:ring-amber-500/50 focus:border-amber-500' : 'bg-slate-800 border-slate-700 focus:ring-emerald-500/50 focus:border-emerald-500'}`} />
                                <button type="submit" disabled={!input.trim()} className={`absolute right-2 top-2 p-1.5 text-white rounded-lg ${isAdmin ? 'bg-amber-600' : 'bg-emerald-600'}`}><Send size={18} /></button>
                            </form>
                        </div>
                    </div>
                </div>

                {/* DASHBOARD AREA */}
                <div className="flex-1 flex flex-col bg-slate-950 h-[40vh] md:h-full overflow-hidden relative border-t md:border-t-0 md:border-l border-slate-800">
                    <div className="p-4 flex items-center justify-between">
                        <h2 className="text-lg font-bold flex items-center gap-2 text-slate-100">
                            <CalendarIcon className="text-emerald-400" />
                            {viewMode === 'list' ? (language.startsWith('es') ? 'Agenda' : 'Agenda') : currentDate.toLocaleString(language, { month: 'short', year: 'numeric' })}
                        </h2>
                        <div className="flex items-center gap-1 bg-slate-900 p-1 rounded-lg border border-slate-800">
                            <button onClick={() => setViewMode('list')} className={`p-2 rounded-md ${viewMode === 'list' ? 'bg-slate-800 text-emerald-400' : 'text-slate-500'}`}><List size={18} /></button>
                            <button onClick={() => setViewMode('calendar')} className={`p-2 rounded-md ${viewMode === 'calendar' ? 'bg-slate-800 text-emerald-400' : 'text-slate-500'}`}><LayoutGrid size={18} /></button>
                        </div>
                    </div>

                    <DndContext sensors={sensors} onDragEnd={handleDragEnd}>
                        {viewMode === 'calendar' && (
                            <div className="flex-1 px-4 pb-4 overflow-hidden flex flex-col">
                                <div className="flex justify-between items-center mb-2">
                                    <button onClick={prevMonth}><ChevronLeft size={20} className="text-slate-400"/></button>
                                    <button onClick={nextMonth}><ChevronRight size={20} className="text-slate-400"/></button>
                                </div>
                                <div className="grid grid-cols-7 gap-1 flex-1 auto-rows-fr">
                                    {Array(firstDayOfMonth).fill(null).map((_, i) => <div key={`e-${i}`} />)}
                                    {Array(daysInMonth).fill(null).map((_, i) => {
                                        const day = i + 1;
                                        const dayEvents = getEventsForDay(day);
                                        return (
                                            <DroppableDay key={day} day={day} month={currentDate.getMonth()} year={currentDate.getFullYear()} onSelect={setSelectedDay}>
                                                {dayEvents.map(ev => <DraggableEvent key={ev.id} event={ev} isAdmin={isAdmin} />)}
                                            </DroppableDay>
                                        );
                                    })}
                                </div>
                            </div>
                        )}
                    </DndContext>

                    {viewMode === 'list' && (
                        <div className="flex-1 overflow-y-auto px-4 pb-4 custom-scrollbar space-y-2">
                            {events.length === 0 && <p className="text-center text-slate-600 mt-10">No events.</p>}
                            {events.map((event) => (
                                <div key={event.id} className="bg-slate-900/50 border border-slate-800 rounded-xl p-3 flex items-center justify-between">
                                    <div className="flex gap-3 items-center">
                                        <div className="flex flex-col items-center bg-slate-800 rounded px-2 py-1 min-w-[50px]">
                                            <span className="text-[10px] text-slate-400 uppercase">{new Date(event.date).toLocaleDateString(language, { month: 'short' })}</span>
                                            <span className="text-lg font-bold text-slate-200">{new Date(event.date).getDate()}</span>
                                        </div>
                                        <div>
                                            <h3 className="font-semibold text-slate-200 text-sm">{event.title}</h3>
                                            <p className="text-xs text-slate-400 flex items-center gap-1"><Clock size={10} className="text-emerald-400" /> {formatTime(event.time, language)}</p>
                                        </div>
                                    </div>
                                    <button onClick={() => handleDelete(event.id)} className="text-slate-600 hover:text-red-400"><Trash2 size={16} /></button>
                                </div>
                            ))}
                        </div>
                    )}
                </div>
            </>
        )}

        {/* STUDY MODE TAB (NOW WITH HEATMAP) */}
        {activeTab === 'study' && (
            <div className="flex-1 flex flex-col items-center justify-start bg-slate-950 relative overflow-hidden p-6 pt-10">
                <div className={`absolute w-[500px] h-[500px] rounded-full blur-[128px] opacity-20 pointer-events-none transition-colors duration-1000 top-0 ${studyMode === 'focus' ? 'bg-emerald-500' : 'bg-blue-500'}`}></div>
                
                <div className="z-10 text-center space-y-8 w-full max-w-2xl flex flex-col items-center">
                    <div className="space-y-2">
                        <h2 className={`text-4xl md:text-6xl font-bold tracking-tight transition-colors ${studyMode === 'focus' ? 'text-emerald-400' : 'text-blue-400'}`}>
                            {studyMode === 'focus' ? (language.startsWith('es') ? 'Modo Enfoque' : 'Focus Mode') : (language.startsWith('es') ? 'Descanso' : 'Break Time')}
                        </h2>
                    </div>

                    <div className={`text-[6rem] md:text-[8rem] font-mono font-bold leading-none tracking-tighter select-none transition-colors ${isTimerRunning ? 'text-white' : 'text-slate-500'}`}>
                        {formatTimer(timeLeft)}
                    </div>

                    <div className="flex items-center justify-center gap-4">
                        <button onClick={() => setIsTimerRunning(!isTimerRunning)} className={`p-6 rounded-full transition-all transform hover:scale-105 active:scale-95 shadow-xl ${isTimerRunning ? 'bg-slate-800 text-red-400 border border-slate-700' : 'bg-emerald-600 text-white hover:bg-emerald-500'}`}>
                            {isTimerRunning ? <Pause size={32} fill="currentColor" /> : <Play size={32} fill="currentColor" className="ml-1"/>}
                        </button>
                        <button onClick={() => { setIsTimerRunning(false); setTimeLeft(studyMode === 'focus' ? 25 * 60 : 5 * 60); }} className="p-6 rounded-full bg-slate-800 text-slate-400 hover:text-white border border-slate-700 hover:bg-slate-700 transition-all">
                            <RotateCcw size={32} />
                        </button>
                    </div>

                    <div className="flex gap-2 justify-center mt-4">
                        <button onClick={() => { setStudyMode('focus'); setTimeLeft(25*60); setIsTimerRunning(false); }} className={`px-4 py-2 rounded-full text-sm font-medium transition-all ${studyMode === 'focus' ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/50' : 'bg-slate-900 text-slate-500 border border-slate-800'}`}>25m Focus</button>
                        <button onClick={() => { setStudyMode('break'); setTimeLeft(5*60); setIsTimerRunning(false); }} className={`px-4 py-2 rounded-full text-sm font-medium transition-all ${studyMode === 'break' ? 'bg-blue-500/20 text-blue-400 border border-blue-500/50' : 'bg-slate-900 text-slate-500 border border-slate-800'}`}>5m Break</button>
                    </div>

                    {/* FOCUS HISTORY TRACKER (Heatmap and Selectors) */}
                    <div className="mt-12 p-6 bg-slate-900/80 backdrop-blur-md rounded-2xl border border-slate-800 w-full max-w-3xl shadow-2xl overflow-y-auto">
                        <div className="flex items-center justify-between mb-4 text-slate-400 text-sm">
                            <div className="flex items-center gap-2">
                                <Activity size={16} className="text-emerald-400" />
                                <span className="font-semibold text-slate-200">{language.startsWith('es') ? 'Historial de Enfoque' : 'Focus History'}</span>
                            </div>
                            <div className="text-xs text-slate-500 flex items-center gap-1">
                                <Flame size={12} className={sessionsCompleted > 0 ? "text-orange-400" : "text-slate-600"} />
                                {language.startsWith('es') ? `${sessionsCompleted} sesiones hoy` : `${sessionsCompleted} sessions today`}
                            </div>
                        </div>
                        
                        <FocusHeatmap logs={focusLogs} focusYear={focusYear} setCurrentYear={setFocusYear} language={language} />
                    </div>
                </div>
            </div>
        )}

      </div>

      {/* MOBILE NAV */}
      <div className="md:hidden fixed bottom-0 left-0 right-0 bg-slate-900/90 backdrop-blur-lg border-t border-slate-800 flex justify-around p-4 z-50">
          <button onClick={() => setActiveTab('schedule')} className={`flex flex-col items-center gap-1 ${activeTab === 'schedule' ? 'text-emerald-400' : 'text-slate-500'}`}><CalendarIcon size={24} /><span className="text-[10px] font-bold">Schedule</span></button>
          <button onClick={() => setActiveTab('study')} className={`flex flex-col items-center gap-1 ${activeTab === 'study' ? 'text-emerald-400' : 'text-slate-500'}`}><BookOpen size={24} /><span className="text-[10px] font-bold">Focus</span></button>
      </div>

      {/* DAY MODAL */}
      {selectedDay !== null && (
            <div className="absolute inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 animate-in fade-in duration-200">
                <div className="bg-slate-900 border border-slate-700 rounded-xl w-full max-w-sm overflow-hidden shadow-2xl animate-in zoom-in-95 duration-200">
                    <div className="p-4 border-b border-slate-800 flex justify-between items-center bg-slate-950/50">
                        <div className="flex items-center gap-2">
                            <div className="bg-emerald-500/10 p-1.5 rounded-lg text-emerald-400 font-bold">{selectedDay}</div>
                            <h3 className="font-semibold text-slate-200">{new Date(currentDate.getFullYear(), currentDate.getMonth(), selectedDay).toLocaleDateString(language, { weekday: 'long', month: 'long' })}</h3>
                        </div>
                        <button onClick={() => setSelectedDay(null)} className="text-slate-500 hover:text-white transition-colors"><XCircle size={20} /></button>
                    </div>
                    <div className="p-4 max-h-[60vh] overflow-y-auto space-y-3 custom-scrollbar">
                        {getEventsForDay(selectedDay).length === 0 ? (
                            <div className="text-center py-6"><p className="text-slate-500 text-sm">No events.</p></div>
                        ) : (
                            getEventsForDay(selectedDay).map((event) => (
                                <div key={event.id} className="flex items-center justify-between bg-slate-800/50 p-3 rounded-lg border border-slate-800 hover:border-emerald-500/30 transition-all">
                                    <div><h4 className="font-medium text-sm text-slate-200">{event.title}</h4><p className="text-xs text-slate-400 mt-0.5"><Clock size={10} className="inline text-emerald-400" /> {formatTime(event.time, language)}</p></div>
                                    <button onClick={() => handleDelete(event.id)} className="text-slate-600 hover:text-red-400"><Trash2 size={14} /></button>
                                </div>
                            ))
                        )}
                    </div>
                </div>
            </div>
      )}
    </div>
  );
}