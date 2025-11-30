import React, { useState, useEffect, useRef } from 'react';
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
  orderBy, 
  onSnapshot, 
  deleteDoc, 
  updateDoc,
  doc,
  serverTimestamp,
  writeBatch,
  where
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
  User, 
  Bell,
  Terminal,
  Mic,
  MicOff,
  Loader2,
  CheckCircle2,
  Repeat,
  ShieldAlert, 
  Code,        
  LayoutGrid, 
  List,       
  ChevronLeft,
  ChevronRight,
  XCircle,
  Check,
  MoreHorizontal,
  Globe,
  CalendarDays,
  GripVertical // Icon for dragging
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

// --- Helper: Date Formatting ---
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

// --- DRAG & DROP COMPONENTS ---

// 1. Draggable Event Dot
function DraggableEvent({ event, isAdmin }) {
  const {attributes, listeners, setNodeRef, transform} = useDraggable({
    id: event.id,
    data: { event } // Pass event data so we know what we are dragging
  });
  
  const style = transform ? {
    transform: CSS.Translate.toString(transform),
    zIndex: 999, // Ensure dragged item is on top
    opacity: 0.8,
    cursor: 'grabbing'
  } : { cursor: 'grab' };

  return (
    <div 
      ref={setNodeRef} 
      style={style} 
      {...listeners} 
      {...attributes}
      className={`h-2 w-2 rounded-full cursor-grab active:cursor-grabbing transition-colors ${event.hasAskedFollowUp ? 'bg-slate-600' : isAdmin ? 'bg-amber-500' : 'bg-emerald-500 ring-2 ring-transparent hover:ring-emerald-300/50'}`} 
      title={`Drag to reschedule: ${event.title}`}
    />
  );
}

// 2. Droppable Calendar Day
function DroppableDay({ day, month, year, children, onSelect }) {
  // Create a unique ID for this day cell (e.g., "day-2023-11-30")
  const dateId = `day-${year}-${month}-${day}`;
  
  const {isOver, setNodeRef} = useDroppable({
    id: dateId,
    data: { day, month, year } // Pass date info so we know WHERE we dropped it
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


// --- The Brain: Logic Parser ---
const parseCommand = (text, manualDateOverride = null) => {
  const lowerText = text.toLowerCase();
  
  if (lowerText.includes('ram sudo mode')) return { isCommand: true, command: 'ACTIVATE_ADMIN', originalText: text };
  if (lowerText.includes('ram exit sudo')) return { isCommand: true, command: 'DEACTIVATE_ADMIN', originalText: text };
  if (lowerText.includes('ram nuke database')) return { isCommand: true, command: 'NUKE_DB', originalText: text };

  // 1. Time Extraction
  const timeRangeRegex = /(\d{1,2}(:\d{2})?\s?(am|pm))\s*(?:-|to|a)\s*(\d{1,2}(:\d{2})?\s?(am|pm))/i;
  const timeRangeMatch = lowerText.match(timeRangeRegex);
  const timeRegex = /(\d{1,2}(:\d{2})?\s?(am|pm)|(\d{1,2}:\d{2})|a las \d{1,2})/i;
  const timeMatch = lowerText.match(timeRegex);

  // 2. Recurrence Extraction
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

  // 3. Date Parsing
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
            dateFound = true; 
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
  const [input, setInput] = useState('');
  const [messages, setMessages] = useState([
    { 
      id: 'intro', 
      sender: 'ram', 
      text: "Hello! I'm Ram v13.0. Try dragging an event in the calendar to reschedule it!" 
    }
  ]);
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

  // --- DRAG SENSORS ---
  // We need sensors to differentiate between a "click" (to open details) and a "drag" (to reschedule)
  const sensors = useSensors(
    useSensor(MouseSensor, {
        activationConstraint: { distance: 8 } // Drag must move 8px to start
    }),
    useSensor(TouchSensor, {
        activationConstraint: { delay: 200, tolerance: 5 } // Long press to drag on mobile
    })
  );

  useEffect(() => {
    const initAuth = async () => {
      try {
        if (typeof __initial_auth_token !== 'undefined' && __initial_auth_token) {
          await signInWithCustomToken(auth, __initial_auth_token);
        } else {
          await signInAnonymously(auth);
        }
      } catch (error) {
        console.error("Authentication Error:", error);
        if (typeof __firebase_config === 'undefined') {
            setMessages(prev => [...prev, { 
                id: Date.now(), 
                sender: 'ram', 
                text: "⚠️ System Alert: I cannot log in. Please enable 'Anonymous Authentication' in your Firebase Console." 
            }]);
        }
      }
    };
    initAuth();
    const unsubscribe = onAuthStateChanged(auth, (u) => { setUser(u); setLoading(false); });
    if ('Notification' in window) setPermission(Notification.permission);
    return () => unsubscribe();
  }, []);

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

  // --- DRAG END HANDLER (Smart Reschedule) ---
  const handleDragEnd = async (event) => {
      const { active, over } = event;
      
      if (over && active.id !== over.id) {
          // 'active.data.current.event' is the event we dragged
          // 'over.data.current' contains the target date (day, month, year)
          
          const draggedEvent = active.data.current.event;
          const target = over.data.current;
          
          if (!target || !draggedEvent) return;

          // Construct new date object
          const originalDate = new Date(draggedEvent.date);
          const newDate = new Date(target.year, target.month, target.day);
          
          // Preserve the original TIME
          newDate.setHours(originalDate.getHours());
          newDate.setMinutes(originalDate.getMinutes());
          
          // Optimistic UI Update (optional, but feels snappier)
          // We rely on Firestore listener for simplicity, but let's notify user
          const msg = language.startsWith('es') 
            ? `🔄 He movido "${draggedEvent.title}" al ${newDate.toLocaleDateString('es-ES')}.`
            : `🔄 I moved "${draggedEvent.title}" to ${newDate.toLocaleDateString()}.`;
            
          setMessages(prev => [...prev, { id: Date.now(), sender: 'ram', text: msg }]);

          // Update Firestore
          try {
              const eventRef = doc(db, 'artifacts', appId, 'users', user.uid, 'schedule', draggedEvent.id);
              await updateDoc(eventRef, {
                  date: newDate.toISOString()
              });
          } catch (err) {
              console.error("Reschedule failed", err);
          }
      }
  };

  useEffect(() => {
    if (!user || events.length === 0) return;
    const interval = setInterval(() => {
      const now = new Date();
      events.forEach(async (event) => {
        const eventDate = new Date(event.date);
        const timeDiff = eventDate - now; 
        const minutesDiff = Math.floor(timeDiff / 1000 / 60);
        const notifKey = `notified_${event.id}`;
        
        if (minutesDiff <= 15 && minutesDiff > 0 && !localStorage.getItem(notifKey)) {
          if (permission === 'granted') {
            const title = language.startsWith('es') ? 'Recordatorio' : 'Upcoming';
            const body = language.startsWith('es') ? `¡${event.title} en ${minutesDiff} min!` : `You have ${event.title} in ${minutesDiff} minutes!`;
            new Notification(title, { body: body, icon: 'https://cdn-icons-png.flaticon.com/512/4712/4712035.png' });
          }
          const msg = language.startsWith('es') 
            ? `🔔 Recordatorio: Tienes "${event.title}" en 15 minutos.` 
            : `🔔 Reminder: You have "${event.title}" coming up in about 15 minutes.`;
          setMessages(prev => [...prev, { id: Date.now(), sender: 'ram', text: msg }]);
          localStorage.setItem(notifKey, 'true');
        }
        
        if (minutesDiff < 0 && !event.hasAskedFollowUp) {
          const hoursPast = Math.abs(timeDiff / 1000 / 60 / 60);
          if (hoursPast < 3) {
             const msg = language.startsWith('es')
                ? `Hola, ¿qué tal fue "${event.title}"?`
                : `Hey, how did "${event.title}" go?`;
             setMessages(prev => [...prev, { id: Date.now(), sender: 'ram', text: msg, isFollowUp: true }]);
          }
          try { await updateDoc(doc(db, 'artifacts', appId, 'users', user.uid, 'schedule', event.id), { hasAskedFollowUp: true }); } catch (e) {}
        }
      });
    }, 10000);
    return () => clearInterval(interval);
  }, [events, user, permission, language]);

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
              responseText = language.startsWith('es')
                ? `Listo. He programado "${analysis.activity}" empezando el ${formatDate(analysis.date, 'es-ES')} (4 semanas).`
                : `Got it. I've scheduled "${analysis.activity}" starting from ${formatDate(analysis.date)} (next 4 weeks).`;
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
        } catch (err) {
          console.error(err);
        }
      } else {
        const errorMsg = language.startsWith('es')
            ? "No entendí la fecha. ¿Podrías usar el icono 📅 o decir '12 de diciembre'?"
            : "I didn't catch the date. Could you use the 📅 icon or say '12th December'?";
        setMessages(prev => [...prev, { id: Date.now() + 1, sender: 'ram', text: errorMsg }]);
      }
    }, 600);
  };

  const startConfirmationListening = () => {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) return;

    const recognition = new SpeechRecognition();
    recognition.continuous = false;
    recognition.lang = language; 
    recognition.interimResults = false;

    recognition.onresult = (e) => {
        const transcript = e.results[0][0].transcript.toLowerCase();
        const isConfirmed = transcript.includes('yes') || transcript.includes('send') || 
                            transcript.includes('si') || transcript.includes('sí') || transcript.includes('claro') || transcript.includes('enviar');
        
        if (isConfirmed) handleSend(null);
        else cancelConfirmation();
    };
    recognition.start();
  };

  const startListening = () => {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) { alert("Use Chrome/Safari."); return; }
    
    if (input.trim().length > 0) previousInputRef.current = input.trim() + " ";
    else previousInputRef.current = "";

    setIsConfirming(false);

    const recognition = new SpeechRecognition();
    recognition.continuous = true; 
    recognition.interimResults = true;
    recognition.lang = language; 

    recognition.onstart = () => setIsListening(true);
    recognition.onend = () => { if (!isConfirming) setIsListening(false); };

    recognition.onresult = (e) => {
        const currentTranscript = Array.from(e.results).map(result => result[0].transcript).join('');
        setInput(previousInputRef.current + currentTranscript);

        if (silenceTimer.current) clearTimeout(silenceTimer.current);
        
        silenceTimer.current = setTimeout(() => {
            recognition.stop();
            setIsListening(false);
            setIsConfirming(true);
            
            if ('speechSynthesis' in window) {
                const text = language.startsWith('es') ? "¿Has terminado?" : "Are you finished?";
                const utterance = new SpeechSynthesisUtterance(text);
                utterance.lang = language; 
                utterance.onend = () => startConfirmationListening();
                window.speechSynthesis.speak(utterance);
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

  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [messages, isConfirming]);

  if (loading) return <div className="h-screen flex items-center justify-center bg-slate-950 text-emerald-400 font-mono">Booting RamOS...</div>;

  return (
    <div className="flex flex-col md:flex-row h-screen bg-slate-950 text-slate-200 font-sans overflow-hidden selection:bg-emerald-500/30">
      <div className="flex-1 flex flex-col border-r border-slate-800 h-[50vh] md:h-full relative">
        <div className={`p-4 border-b border-slate-800 ${isAdmin ? 'bg-amber-900/20' : 'bg-slate-900/50'} flex items-center justify-between backdrop-blur-sm z-10 transition-colors duration-500`}>
          <div className="flex items-center gap-2">
            <div className={`p-2 rounded-lg transition-colors duration-500 ${isAdmin ? 'bg-amber-500/20' : 'bg-emerald-500/10'}`}>
                {isAdmin ? <ShieldAlert size={20} className="text-amber-500" /> : <Terminal size={20} className="text-emerald-400" />}
            </div>
            <div>
              <h1 className="font-bold text-slate-100">{isAdmin ? 'Ram [ADMIN]' : 'Ram Assistant'}</h1>
              <p className={`text-xs flex items-center gap-1 ${isAdmin ? 'text-amber-500' : 'text-emerald-500'}`}>
                <span className={`w-2 h-2 rounded-full animate-pulse ${isAdmin ? 'bg-amber-500' : 'bg-emerald-500'}`}></span>
                {isAdmin ? 'Override' : 'Online'}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
             <button onClick={() => setLanguage(l => l === 'en-US' ? 'es-ES' : 'en-US')} className="p-2 bg-slate-800 hover:bg-slate-700 rounded-lg text-slate-400 hover:text-emerald-400 transition-all flex items-center gap-1 text-xs font-bold" title="Switch Language">
                <Globe size={16} />
                {language === 'en-US' ? 'EN' : 'ES'}
             </button>
             {permission !== 'granted' && (
                <button onClick={requestNotification} className="p-2 bg-slate-800 hover:bg-slate-700 rounded-full text-slate-400 hover:text-emerald-400 transition-all">
                <Bell size={18} />
                </button>
             )}
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
                <p className="text-sm text-emerald-400 font-semibold mb-2 flex items-center gap-2">
                    <Bot size={16} /> {language.startsWith('es') ? 'Escuché:' : 'I heard:'}
                </p>
                <p className="text-slate-200 italic mb-4">"{input}"</p>
                <div className="flex items-center justify-between gap-3">
                    <p className="text-xs text-slate-400 animate-pulse">{language.startsWith('es') ? '¿Has terminado?' : 'Are you finished?'}</p>
                    <div className="flex gap-2">
                        <button onClick={cancelConfirmation} className="px-3 py-1.5 text-xs bg-slate-700 hover:bg-slate-600 rounded-lg text-slate-200 transition-colors flex items-center gap-1">
                            <MoreHorizontal size={14} /> {language.startsWith('es') ? 'No' : 'No'}
                        </button>
                        <button onClick={(e) => handleSend(e)} className="px-3 py-1.5 text-xs bg-emerald-600 hover:bg-emerald-500 rounded-lg text-white font-medium transition-colors flex items-center gap-1">
                            <Check size={14} /> {language.startsWith('es') ? 'Sí' : 'Yes'}
                        </button>
                    </div>
                </div>
            </div>
        )}

        <div className="p-4 bg-slate-900 border-t border-slate-800">
          <div className="flex items-center gap-2">
            <button onClick={startListening} className={`p-3 rounded-xl transition-all ${isListening ? 'bg-red-500/20 text-red-500 animate-pulse ring-2 ring-red-500/50' : 'bg-slate-800 text-slate-400 hover:bg-slate-700 hover:text-emerald-400'}`} title="Voice Command">
              {isListening ? <MicOff size={20} /> : <Mic size={20} />}
            </button>
            
            <div className="relative group">
                <input 
                    type="datetime-local" 
                    ref={dateInputRef}
                    className="absolute inset-0 opacity-0 cursor-pointer w-full h-full z-10"
                    onChange={(e) => setPickerDate(e.target.value)}
                />
                <button 
                    className={`p-3 rounded-xl transition-all duration-300 ${pickerDate ? 'text-emerald-400 bg-emerald-400/10 ring-1 ring-emerald-400/50' : 'bg-slate-800 text-slate-400 group-hover:bg-slate-700 group-hover:text-emerald-400'}`}
                    title="Pick a Date Manually"
                >
                    <CalendarDays size={20} />
                </button>
            </div>

            <form onSubmit={handleSend} className="flex-1 relative">
              <input type="text" value={input} onChange={(e) => setInput(e.target.value)} placeholder={pickerDate ? (language.startsWith('es') ? `Fecha seleccionada. ¿Qué evento?` : "Date selected. What's the event?") : (isListening ? (language.startsWith('es') ? "Escuchando..." : "Listening...") : (language.startsWith('es') ? "Escribe o usa el micro..." : "Type or use mic..."))} className={`w-full text-slate-200 pl-4 pr-12 py-3 rounded-xl border focus:outline-none focus:ring-2 transition-all placeholder:text-slate-500 ${isAdmin ? 'bg-amber-900/10 border-amber-900/50 focus:ring-amber-500/50 focus:border-amber-500' : 'bg-slate-800 border-slate-700 focus:ring-emerald-500/50 focus:border-emerald-500'}`} />
              <button type="submit" disabled={!input.trim()} className={`absolute right-2 top-2 p-1.5 text-white rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${isAdmin ? 'bg-amber-600 hover:bg-amber-500' : 'bg-emerald-600 hover:bg-emerald-500'}`}><Send size={18} /></button>
            </form>
          </div>
        </div>
      </div>

      <div className="flex-1 flex flex-col bg-slate-950 h-[50vh] md:h-full overflow-hidden relative">
        <div className="p-6 pb-2">
            <div className="flex items-center justify-between mb-4">
                <h2 className="text-xl font-bold flex items-center gap-2 text-slate-100">
                    <CalendarIcon className="text-emerald-400" />
                    {viewMode === 'list' 
                        ? (language.startsWith('es') ? 'Cronología' : 'Timeline') 
                        : currentDate.toLocaleString(language, { month: 'long', year: 'numeric' })}
                </h2>
                
                <div className="flex items-center gap-2 bg-slate-900 p-1 rounded-lg border border-slate-800">
                    <button onClick={() => setViewMode('list')} className={`p-2 rounded-md transition-all ${viewMode === 'list' ? 'bg-slate-800 text-emerald-400 shadow-sm' : 'text-slate-500 hover:text-slate-300'}`}><List size={18} /></button>
                    <button onClick={() => setViewMode('calendar')} className={`p-2 rounded-md transition-all ${viewMode === 'calendar' ? 'bg-slate-800 text-emerald-400 shadow-sm' : 'text-slate-500 hover:text-slate-300'}`}><LayoutGrid size={18} /></button>
                </div>
            </div>
            
            {viewMode === 'calendar' && (
                <div className="flex justify-between items-center mb-4 text-sm">
                     <button onClick={prevMonth} className="p-1 hover:bg-slate-900 rounded-full text-slate-400 hover:text-white"><ChevronLeft size={20}/></button>
                     <span className="text-slate-400 font-mono text-xs uppercase tracking-wider">{language.startsWith('es') ? 'MES' : 'MONTH'}</span>
                     <button onClick={nextMonth} className="p-1 hover:bg-slate-900 rounded-full text-slate-400 hover:text-white"><ChevronRight size={20}/></button>
                </div>
            )}
        </div>

        {/* --- DND CONTEXT WRAPPER FOR DRAG SUPPORT --- */}
        <DndContext sensors={sensors} onDragEnd={handleDragEnd}>
            {viewMode === 'calendar' && (
                <div className="flex-1 px-6 pb-6 overflow-hidden flex flex-col">
                    <div className="grid grid-cols-7 mb-2 text-center">
                        {(language.startsWith('es') ? ['Dom','Lun','Mar','Mie','Jue','Vie','Sab'] : ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']).map(d => (
                            <div key={d} className="text-xs font-bold text-slate-500 uppercase">{d}</div>
                        ))}
                    </div>
                    
                    <div className="grid grid-cols-7 gap-1 flex-1 auto-rows-fr">
                        {Array(firstDayOfMonth).fill(null).map((_, i) => (
                            <div key={`empty-${i}`} className="bg-transparent" />
                        ))}
                        
                        {Array(daysInMonth).fill(null).map((_, i) => {
                            const day = i + 1;
                            const dayEvents = getEventsForDay(day);
                            return (
                                <DroppableDay 
                                    key={day} 
                                    day={day} 
                                    month={currentDate.getMonth()} 
                                    year={currentDate.getFullYear()}
                                    onSelect={setSelectedDay}
                                >
                                    {dayEvents.map(ev => (
                                        <DraggableEvent key={ev.id} event={ev} isAdmin={isAdmin} />
                                    ))}
                                </DroppableDay>
                            );
                        })}
                    </div>
                </div>
            )}
        </DndContext>

        {viewMode === 'list' && (
            <div className="flex-1 overflow-y-auto px-6 pb-6 custom-scrollbar space-y-3">
                {events.length === 0 ? (
                <div className="text-center py-12 border-2 border-dashed border-slate-800 rounded-xl">
                    <Bot size={48} className="mx-auto text-slate-700 mb-4" /><p className="text-slate-500">{language.startsWith('es') ? 'Sin eventos.' : 'No events.'}</p>
                </div>
                ) : (
                events.map((event) => (
                    <div key={event.id} className={`group border rounded-xl p-4 transition-all duration-200 flex items-center justify-between ${event.hasAskedFollowUp ? 'bg-slate-900/30 border-slate-800 opacity-60' : 'bg-slate-900/50 hover:bg-slate-800 border-slate-800 hover:border-emerald-500/30'}`}>
                    <div className="flex items-start gap-4">
                        <div className={`flex flex-col items-center rounded-lg p-2 min-w-[60px] border ${event.hasAskedFollowUp ? 'bg-slate-900 border-slate-800' : 'bg-slate-800 border-slate-700'}`}>
                        <span className="text-xs text-slate-400 uppercase font-bold">{new Date(event.date).toLocaleDateString(language, { month: 'short' })}</span>
                        <span className="text-xl font-bold text-slate-200">{new Date(event.date).getDate()}</span>
                        </div>
                        <div>
                        <h3 className={`font-semibold text-lg ${event.hasAskedFollowUp ? 'text-slate-500 line-through' : 'text-slate-200'}`}>
                            {event.title}
                            {isAdmin && <span className="ml-2 text-[10px] text-amber-500 font-mono opacity-50">ID: {event.id.slice(0,4)}</span>}
                        </h3>
                        <div className="flex items-center gap-3 mt-1 text-sm text-slate-400">
                            <span className="flex items-center gap-1 bg-slate-800/50 px-2 py-0.5 rounded">
                            <Clock size={14} className={event.hasAskedFollowUp ? 'text-slate-600' : 'text-emerald-400'} />
                            {formatTime(event.time, language)}
                            </span>
                            {event.isRecurringInstance && <span title="Recurring Event"><Repeat size={14} className="text-slate-500"/></span>}
                            {event.hasAskedFollowUp && <span className="flex items-center gap-1 text-emerald-500"><CheckCircle2 size={14} /> {language.startsWith('es') ? 'Hecho' : 'Done'}</span>}
                        </div>
                        </div>
                    </div>
                    <button onClick={() => handleDelete(event.id)} className="p-2 text-slate-600 hover:text-red-400 hover:bg-red-400/10 rounded-lg opacity-0 group-hover:opacity-100 transition-all"><Trash2 size={18} /></button>
                    </div>
                ))
                )}
            </div>
        )}

        {/* --- DAY DETAILS MODAL --- */}
        {selectedDay !== null && (
            <div className="absolute inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 animate-in fade-in duration-200">
                <div className="bg-slate-900 border border-slate-700 rounded-xl w-full max-w-sm overflow-hidden shadow-2xl animate-in zoom-in-95 duration-200">
                    <div className="p-4 border-b border-slate-800 flex justify-between items-center bg-slate-950/50">
                        <div className="flex items-center gap-2">
                            <div className="bg-emerald-500/10 p-1.5 rounded-lg text-emerald-400 font-bold">{selectedDay}</div>
                            <h3 className="font-semibold text-slate-200">
                                {new Date(currentDate.getFullYear(), currentDate.getMonth(), selectedDay).toLocaleDateString(language, { weekday: 'long', month: 'long' })}
                            </h3>
                        </div>
                        <button onClick={() => setSelectedDay(null)} className="text-slate-500 hover:text-white transition-colors"><XCircle size={20} /></button>
                    </div>
                    
                    <div className="p-4 max-h-[60vh] overflow-y-auto space-y-3 custom-scrollbar">
                        {getEventsForDay(selectedDay).length === 0 ? (
                            <div className="text-center py-6">
                                <p className="text-slate-500 text-sm">{language.startsWith('es') ? 'Sin eventos.' : 'No events planned.'}</p>
                                <button onClick={() => { setInput(language.startsWith('es') ? `Agendar evento el ${selectedDay} de ${currentDate.toLocaleString('es-ES', { month: 'long' })} a las ` : `Schedule event on the ${selectedDay}th of ${currentDate.toLocaleString('default', { month: 'long' })} at `); setSelectedDay(null); }} className="mt-2 text-xs text-emerald-400 hover:underline">
                                    + {language.startsWith('es') ? 'Crear' : 'Add Event'}
                                </button>
                            </div>
                        ) : (
                            getEventsForDay(selectedDay).map((event) => (
                                <div key={event.id} className="flex items-center justify-between bg-slate-800/50 p-3 rounded-lg border border-slate-800 hover:border-emerald-500/30 transition-all">
                                    <div>
                                        <h4 className={`font-medium text-sm ${event.hasAskedFollowUp ? 'text-slate-500 line-through' : 'text-slate-200'}`}>{event.title}</h4>
                                        <p className="text-xs text-slate-400 mt-0.5 flex items-center gap-1"><Clock size={10} className="text-emerald-400" /> {formatTime(event.time, language)}</p>
                                    </div>
                                    <button onClick={() => handleDelete(event.id)} className="text-slate-600 hover:text-red-400 p-1.5 rounded-md hover:bg-red-900/20 transition-all"><Trash2 size={14} /></button>
                                </div>
                            ))
                        )}
                    </div>
                </div>
            </div>
        )}
      </div>
    </div>
  );
}