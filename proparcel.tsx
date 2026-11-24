import React, { useState, useEffect, useMemo, useRef } from 'react';
import { initializeApp } from 'firebase/app';
import {
  getAuth,
  signInAnonymously,
  signInWithCustomToken,
  onAuthStateChanged,
} from 'firebase/auth';
import {
  getFirestore,
  collection,
  doc,
  setDoc,
  addDoc,
  updateDoc,
  deleteDoc,
  onSnapshot,
  getDocs,
} from 'firebase/firestore';
import {
  Package,
  Users,
  PlusCircle,
  Trophy,
  Shield,
  Sun,
  Moon,
  User,
  CheckCircle2,
  Star,
  Clock,
  Camera,
  Phone,
  MapPin,
  ThumbsUp,
  ThumbsDown,
  Flag,
  Ban,
  Share2,
  Edit3,
  Trash2,
  HelpCircle,
  Send,
  LogOut,
  Sparkles,
  AlertCircle,
  Lock,
  Calendar,
  X,
  UserPlus,
  RefreshCw,
} from 'lucide-react';

// ============================================================================
// FIREBASE INITIALIZATION (OUTSIDE COMPONENT - MANDATORY PATTERN)
// ============================================================================
const firebaseConfig =
  typeof __firebase_config !== 'undefined' ? JSON.parse(__firebase_config) : {};
const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);
const appId = typeof __app_id !== 'undefined' ? __app_id : 'pro-parcel-app';

// Strict Firestore Path Helpers (RULE 1)
const publicCol = (name) => collection(db, 'artifacts', appId, 'public', 'data', name);
const publicDoc = (name, id) => doc(db, 'artifacts', appId, 'public', 'data', name, id);
const privatePrefsDoc = (uid) => doc(db, 'artifacts', appId, 'users', uid, 'prefs', 'me');

// ============================================================================
// CONSTANTS & UTILITIES
// ============================================================================
const VALID_COURIERS = ['Amazon', 'Flipkart', 'Meesho', 'Myntra', 'Other'];
const VALID_SIZES = ['Small', 'Medium', 'Heavy'];
const DEFAULT_CAMPUS = 'VIT Bhopal';
const DEFAULT_NOTICE =
  'Parcel collection desk is typically open 11:00 AM – 6:00 PM. Confirm timings before walking over.';

function getTodayISO(offsetDays = 0) {
  const d = new Date();
  d.setDate(d.getDate() + offsetDays);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function normalizePhone(raw) {
  if (!raw || typeof raw !== 'string') return null;
  let cleaned = raw.trim().replace(/[\s\-().]/g, '');
  if (cleaned.startsWith('00')) cleaned = '+' + cleaned.slice(2);
  if (/^0\d{10}$/.test(cleaned)) cleaned = cleaned.slice(1);
  if (/^\d{10}$/.test(cleaned)) cleaned = '+91' + cleaned;
  else if (/^91\d{10}$/.test(cleaned)) cleaned = '+' + cleaned;
  if (!/^\+\d{10,15}$/.test(cleaned)) return null;
  return cleaned;
}

function generateOTP(digits = 6) {
  const min = Math.pow(10, digits - 1);
  const max = Math.pow(10, digits) - 1;
  return String(Math.floor(min + Math.random() * (max - min + 1)));
}

function formatDateLabel(isoDate) {
  if (!isoDate) return '';
  const today = getTodayISO(0);
  const tomorrow = getTodayISO(1);
  const d = new Date(`${isoDate}T00:00:00`);
  const pretty = d.toLocaleDateString(undefined, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  });
  if (isoDate === today) return `Today (${pretty})`;
  if (isoDate === tomorrow) return `Tomorrow (${pretty})`;
  return pretty;
}

function formatMinutes(mins) {
  if (!mins || mins <= 0) return '0 mins';
  if (mins < 60) return `${mins} mins`;
  const hrs = Math.floor(mins / 60);
  const rem = mins % 60;
  return rem ? `${hrs}h ${rem}m` : `${hrs}h`;
}

function blockPairKey(a, b) {
  return a < b ? `${a}__${b}` : `${b}__${a}`;
}

// ============================================================================
// GEMINI VISION API (SCREENSHOT EXTRACTION WITH EXPONENTIAL BACKOFF)
// ============================================================================
async function extractParcelFromImage(base64Data, mimeType) {
  const apiKey = '';
  const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-3-flash-preview:generateContent?key=${apiKey}`;
  const today = getTodayISO(0);

  const prompt = `Extract parcel delivery details from this order or tracking screenshot.
Today's date is ${today}.
STRICT PRIVACY RULE: Completely ignore and NEVER output personal delivery addresses, recipient names, or phone numbers.
Convert relative dates like "Arriving tomorrow" or "Arriving Friday" into YYYY-MM-DD based on today (${today}).
Guess parcel_size from the item (e.g., phone case/book/earbuds = Small, shoes/clothes/backpack = Medium, chair/kettle/monitor/bulk box = Heavy). Default to Small if unsure.
Pick courier from: Amazon, Flipkart, Meesho, Myntra, Other.`;

  const payload = {
    contents: [
      {
        role: 'user',
        parts: [
          { text: prompt },
          {
            inlineData: {
              mimeType: mimeType || 'image/png',
              data: base64Data,
            },
          },
        ],
      },
    ],
    generationConfig: {
      responseMimeType: 'application/json',
      responseSchema: {
        type: 'OBJECT',
        properties: {
          delivery_date: { type: 'STRING', nullable: true },
          courier: { type: 'STRING' },
          item_name: { type: 'STRING', nullable: true },
          time_slot: { type: 'STRING', nullable: true },
          order_id: { type: 'STRING', nullable: true },
          parcel_size: { type: 'STRING' },
        },
      },
    },
  };

  let delay = 1000;
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      const resp = await fetch(apiUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (resp.status === 429 || resp.status >= 500) {
        if (attempt < 3) {
          await new Promise((r) => setTimeout(r, delay));
          delay *= 2;
          continue;
        }
      }
      if (!resp.ok) return null;
      const result = await resp.json();
      const rawText = result?.candidates?.[0]?.content?.parts?.[0]?.text;
      if (!rawText) return null;
      const parsed = JSON.parse(rawText);

      const dateStr =
        typeof parsed.delivery_date === 'string' &&
        /^\d{4}-\d{2}-\d{2}$/.test(parsed.delivery_date.trim())
          ? parsed.delivery_date.trim()
          : '';

      const matchedCourier =
        VALID_COURIERS.find(
          (c) => c.toLowerCase() === String(parsed.courier || '').trim().toLowerCase()
        ) || 'Other';

      const matchedSize =
        VALID_SIZES.find(
          (s) => s.toLowerCase() === String(parsed.parcel_size || '').trim().toLowerCase()
        ) || 'Small';

      return {
        delivery_date: dateStr,
        courier: matchedCourier,
        item_name: parsed.item_name ? String(parsed.item_name).trim().slice(0, 150) : '',
        time_slot: parsed.time_slot ? String(parsed.time_slot).trim().slice(0, 80) : '',
        order_id: parsed.order_id ? String(parsed.order_id).trim().slice(0, 90) : '',
        parcel_size: matchedSize,
      };
    } catch {
      if (attempt < 3) {
        await new Promise((r) => setTimeout(r, delay));
        delay *= 2;
      } else {
        return null;
      }
    }
  }
  return null;
}

// ============================================================================
// MATCHING ENGINE (GROUPS ALL COMPATIBLE SAME-CAMPUS, SAME-DATE STUDENTS)
// ============================================================================
async function syncMatchesForDate(campus, deliveryDate) {
  if (!campus || !deliveryDate) return { newlyMatched: false };

  const campusLower = campus.trim().toLowerCase();

  // Fetch snapshots once (simple collection reads - RULE 2 compliant)
  const [parcelsSnap, matchesSnap, blocksSnap] = await Promise.all([
    getDocs(publicCol('parcels')),
    getDocs(publicCol('matches')),
    getDocs(publicCol('blocks')),
  ]);

  const dateParcels = parcelsSnap.docs
    .map((d) => ({ id: d.id, ...d.data() }))
    .filter(
      (p) =>
        (p.campus || '').trim().toLowerCase() === campusLower &&
        p.delivery_date === deliveryDate
    )
    .sort((a, b) => (a.created_at || 0) - (b.created_at || 0));

  const existingGroups = matchesSnap.docs
    .map((d) => ({ id: d.id, ...d.data() }))
    .filter(
      (g) =>
        (g.campus || '').trim().toLowerCase() === campusLower &&
        g.delivery_date === deliveryDate
    )
    .sort((a, b) => (a.created_at || 0) - (b.created_at || 0));

  const blockedSet = new Set();
  blocksSnap.docs.forEach((d) => {
    const b = d.data();
    if (b.blocker_id && b.blocked_id) {
      blockedSet.add(blockPairKey(b.blocker_id, b.blocked_id));
    }
  });

  const activeUserIds = [...new Set(dateParcels.map((p) => p.user_id))];
  const activeUserSet = new Set(activeUserIds);

  const assignedUserToGroupId = new Map();
  const editableGroups = []; // { id, data, memberIds: Set, prevSize: number, dirty: boolean }
  let newlyMatched = false;

  // 1. Preserve collected groups; clean up non-collected groups
  for (const g of existingGroups) {
    const membersObj = { ...(g.members || {}) };
    const memberKeys = Object.keys(membersObj);

    if (g.status === 'collected') {
      memberKeys.forEach((uid) => {
        if (activeUserSet.has(uid)) assignedUserToGroupId.set(uid, g.id);
      });
      continue;
    }

    let dirty = false;
    let collectorId = g.collector_user_id || null;
    let status = g.status || 'needs_volunteer';

    // Remove members who no longer have parcels on this date
    for (const uid of memberKeys) {
      if (!activeUserSet.has(uid)) {
        delete membersObj[uid];
        dirty = true;
        if (collectorId === uid) {
          collectorId = null;
          status = 'needs_volunteer';
        }
      }
    }

    // Separate any blocked pairs inside the existing group
    const keptIds = new Set();
    for (const uid of Object.keys(membersObj)) {
      let conflict = false;
      for (const kept of keptIds) {
        if (blockedSet.has(blockPairKey(uid, kept))) {
          conflict = true;
          break;
        }
      }
      if (conflict) {
        delete membersObj[uid];
        dirty = true;
        if (collectorId === uid) {
          collectorId = null;
          status = 'needs_volunteer';
        }
      } else {
        keptIds.add(uid);
        assignedUserToGroupId.set(uid, g.id);
      }
    }

    editableGroups.push({
      id: g.id,
      campus: g.campus,
      delivery_date: g.delivery_date,
      collector_user_id: collectorId,
      status,
      members: membersObj,
      memberIds: keptIds,
      prevSize: keptIds.size,
      dirty,
      isNew: false,
    });
  }

  // 2. Assign every unassigned user with a parcel into a compatible group
  for (const uid of activeUserIds) {
    if (assignedUserToGroupId.has(uid)) continue;

    let chosen = null;
    for (const ag of editableGroups) {
      let conflict = false;
      for (const mid of ag.memberIds) {
        if (blockedSet.has(blockPairKey(uid, mid))) {
          conflict = true;
          break;
        }
      }
      if (!conflict) {
        chosen = ag;
        break;
      }
    }

    if (!chosen) {
      const newRef = doc(publicCol('matches'));
      chosen = {
        id: newRef.id,
        campus: campus.trim(),
        delivery_date: deliveryDate,
        collector_user_id: null,
        status: 'needs_volunteer',
        members: {},
        memberIds: new Set(),
        prevSize: 0,
        dirty: true,
        isNew: true,
      };
      editableGroups.push(chosen);
    }

    chosen.members[uid] = {
      volunteer_choice: 'undecided',
      share_phone: false,
      handover_code: null,
      handed_over_at: null,
      joined_at: Date.now(),
    };
    chosen.memberIds.add(uid);
    chosen.dirty = true;
    assignedUserToGroupId.set(uid, chosen.id);

    if (chosen.memberIds.size >= 2 && chosen.memberIds.size > chosen.prevSize) {
      newlyMatched = true;
    }
  }

  // 3. Persist updated/new/deleted match groups
  for (const ag of editableGroups) {
    if (ag.memberIds.size === 0) {
      if (!ag.isNew) {
        await deleteDoc(publicDoc('matches', ag.id));
      }
    } else if (ag.isNew) {
      await setDoc(publicDoc('matches', ag.id), {
        campus: ag.campus,
        delivery_date: ag.delivery_date,
        collector_user_id: ag.collector_user_id,
        status: ag.status,
        handover_spot: '',
        collected_at: null,
        members: ag.members,
        created_at: Date.now(),
      });
    } else if (ag.dirty) {
      await updateDoc(publicDoc('matches', ag.id), {
        collector_user_id: ag.collector_user_id,
        status: ag.status,
        members: ag.members,
      });
    }
  }

  // 4. Update each parcel's match_group_id if changed
  for (const p of dateParcels) {
    const targetGroupId = assignedUserToGroupId.get(p.user_id) || null;
    if (p.match_group_id !== targetGroupId) {
      await updateDoc(publicDoc('parcels', p.id), { match_group_id: targetGroupId });
    }
  }

  return { newlyMatched };
}

// ============================================================================
// MAIN APPLICATION COMPONENT
// ============================================================================
export default function App() {
  // Auth & Boot State
  const [authUser, setAuthUser] = useState(null);
  const [authReady, setAuthReady] = useState(false);
  const [prefsLoaded, setPrefsLoaded] = useState(false);

  // User Preferences (stored in private Firestore doc - no localStorage)
  const [activeProfileId, setActiveProfileId] = useState(null);
  const [adminReturnId, setAdminReturnId] = useState(null);
  const [darkMode, setDarkMode] = useState(false);
  const [guideDismissed, setGuideDismissed] = useState(false);

  // Live Firestore Collections
  const [settings, setSettings] = useState({
    invite_code: '',
    parcel_notice: DEFAULT_NOTICE,
  });
  const [users, setUsers] = useState([]);
  const [parcels, setParcels] = useState([]);
  const [matches, setMatches] = useState([]);
  const [ratings, setRatings] = useState([]);
  const [blocks, setBlocks] = useState([]);
  const [reports, setReports] = useState([]);
  const [feedbackList, setFeedbackList] = useState([]);

  // Navigation & UI State
  const [activeTab, setActiveTab] = useState('matches');
  const [toast, setToast] = useState(null);
  const [modal, setModal] = useState(null); // { type, data }
  const toastTimerRef = useRef(null);

  // Parcel Editing / AI Scan State
  const [editingParcel, setEditingParcel] = useState(null);
  const [deleteConfirmId, setDeleteConfirmId] = useState(null);
  const deleteTimerRef = useRef(null);
  const [seedingDemo, setSeedingDemo] = useState(false);

  // Leaderboard Period
  const [heroPeriod, setHeroPeriod] = useState('all_time');

  // Toast helper
  const showToast = (message, type = 'info') => {
    setToast({ message, type });
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    toastTimerRef.current = setTimeout(() => setToast(null), 3800);
  };

  // ============================================================================
  // EFFECT 1: FIREBASE AUTHENTICATION FIRST (RULE 3)
  // ============================================================================
  useEffect(() => {
    let active = true;
    const initAuth = async () => {
      try {
        if (typeof __initial_auth_token !== 'undefined' && __initial_auth_token) {
          await signInWithCustomToken(auth, __initial_auth_token);
        } else {
          await signInAnonymously(auth);
        }
      } catch (err) {
        console.error('Auth error:', err);
      }
    };
    initAuth();

    const unsub = onAuthStateChanged(auth, (user) => {
      if (!active) return;
      setAuthUser(user);
      setAuthReady(true);
    });
    return () => {
      active = false;
      unsub();
    };
  }, []);

  // ============================================================================
  // EFFECT 2: FIRESTORE REALTIME LISTENERS (GUARDED BY authUser - RULE 3)
  // ============================================================================
  useEffect(() => {
    if (!authUser) return;

    const unsubs = [];

    // Private preferences listener
    unsubs.push(
      onSnapshot(
        privatePrefsDoc(authUser.uid),
        (snap) => {
          if (snap.exists()) {
            const d = snap.data();
            if (d.activeProfileId !== undefined) setActiveProfileId(d.activeProfileId);
            if (d.adminReturnId !== undefined) setAdminReturnId(d.adminReturnId);
            if (typeof d.darkMode === 'boolean') setDarkMode(d.darkMode);
            if (typeof d.guideDismissed === 'boolean') setGuideDismissed(d.guideDismissed);
          }
          setPrefsLoaded(true);
        },
        (err) => {
          console.error('Prefs listener error:', err);
          setPrefsLoaded(true);
        }
      )
    );

    // Public settings listener
    unsubs.push(
      onSnapshot(
        publicDoc('settings', 'global'),
        (snap) => {
          if (snap.exists()) {
            const d = snap.data();
            setSettings({
              invite_code: d.invite_code || '',
              parcel_notice: d.parcel_notice ?? DEFAULT_NOTICE,
            });
          }
        },
        (err) => console.error('Settings listener error:', err)
      )
    );

    const bindCollection = (colName, setter) => {
      const u = onSnapshot(
        publicCol(colName),
        (snap) => {
          setter(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
        },
        (err) => console.error(`${colName} listener error:`, err)
      );
      unsubs.push(u);
    };

    bindCollection('users', setUsers);
    bindCollection('parcels', setParcels);
    bindCollection('matches', setMatches);
    bindCollection('ratings', setRatings);
    bindCollection('blocks', setBlocks);
    bindCollection('reports', setReports);
    bindCollection('feedback', setFeedbackList);

    return () => unsubs.forEach((fn) => fn());
  }, [authUser]);

  // Persist preference updates to private Firestore doc
  const savePrefs = async (patch) => {
    if (!authUser) return;
    try {
      await setDoc(privatePrefsDoc(authUser.uid), patch, { merge: true });
    } catch (err) {
      console.error('Could not save preferences:', err);
    }
  };

  const toggleDarkMode = () => {
    const next = !darkMode;
    setDarkMode(next);
    savePrefs({ darkMode: next });
  };

  const dismissGuide = () => {
    setGuideDismissed(true);
    savePrefs({ guideDismissed: true });
  };

  const loginAsProfile = async (profileId, returnAdminId = null) => {
    setActiveProfileId(profileId);
    setAdminReturnId(returnAdminId);
    setActiveTab('matches');
    await savePrefs({ activeProfileId: profileId, adminReturnId: returnAdminId });
  };

  const handleSignOut = async () => {
    setActiveProfileId(null);
    setAdminReturnId(null);
    setModal(null);
    await savePrefs({ activeProfileId: null, adminReturnId: null });
    showToast('Signed out.', 'info');
  };

  // ============================================================================
  // DERIVED METRICS: USER STATS, BADGES, MATCHES, TIME SAVED, LEADERBOARD
  // ============================================================================
  const usersById = useMemo(() => {
    const map = {};
    users.forEach((u) => {
      map[u.id] = u;
    });
    return map;
  }, [users]);

  const currentUser = activeProfileId ? usersById[activeProfileId] || null : null;

  // Completed trips & net ratings per user
  const userStatsMap = useMemo(() => {
    const map = {};
    const ensure = (uid) => {
      if (!map[uid]) {
        map[uid] = {
          completedTrips: 0,
          studentsHelped: 0,
          monthTrips: 0,
          monthStudentsHelped: 0,
          netRating: 0,
          savedTrips: 0,
        };
      }
      return map[uid];
    };

    const now = new Date();
    const monthStartMs = new Date(now.getFullYear(), now.getMonth(), 1).getTime();

    matches.forEach((m) => {
      if (m.status !== 'collected' || !m.collector_user_id) return;
      const membersObj = m.members || {};
      const handedOverOthers = Object.entries(membersObj).filter(
        ([uid, info]) => uid !== m.collector_user_id && info?.handed_over_at
      );

      if (handedOverOthers.length > 0) {
        const colStats = ensure(m.collector_user_id);
        colStats.completedTrips += 1;
        colStats.studentsHelped += handedOverOthers.length;

        if ((m.collected_at || 0) >= monthStartMs) {
          colStats.monthTrips += 1;
          colStats.monthStudentsHelped += handedOverOthers.length;
        }

        handedOverOthers.forEach(([uid]) => {
          ensure(uid).savedTrips += 1;
        });
      }
    });

    ratings.forEach((r) => {
      if (r.collector_user_id) {
        ensure(r.collector_user_id).netRating += Number(r.score || 0);
      }
    });

    return map;
  }, [matches, ratings]);

  const isUserTrusted = (uid) => {
    const st = userStatsMap[uid];
    return Boolean(st && st.completedTrips >= 3 && st.netRating >= 0);
  };

  // Campus-wide and personal walking time saved (40 mins per saved trip)
  const walkingStats = useMemo(() => {
    let campusSavedTrips = 0;
    Object.values(userStatsMap).forEach((st) => {
      campusSavedTrips += st.savedTrips;
    });
    const mySavedTrips = currentUser ? userStatsMap[currentUser.id]?.savedTrips || 0 : 0;
    return {
      campusSavedTrips,
      campusMinutesSaved: campusSavedTrips * 40,
      mySavedTrips,
      myMinutesSaved: mySavedTrips * 40,
    };
  }, [userStatsMap, currentUser]);

  // Enriched Matches for Current User (Groups of 2+, Today & Tomorrow first)
  const myMatches = useMemo(() => {
    if (!currentUser) return [];
    const today = getTodayISO(0);
    const tomorrow = getTodayISO(1);
    const weekAgo = getTodayISO(-7);

    const relevant = matches
      .filter((m) => {
        const mems = m.members || {};
        return (
          Boolean(mems[currentUser.id]) &&
          Object.keys(mems).length >= 2 &&
          m.delivery_date >= weekAgo
        );
      })
      .map((m) => {
        const membersObj = m.members || {};
        const collector = m.collector_user_id ? usersById[m.collector_user_id] : null;

        const memberList = Object.entries(membersObj)
          .sort((a, b) => (a[1].joined_at || 0) - (b[1].joined_at || 0))
          .map(([uid, info]) => {
            const u = usersById[uid] || {
              id: uid,
              name: 'Student',
              block_wing: '-',
              room_number: '-',
              is_verified: false,
            };
            const isMe = uid === currentUser.id;
            const userParcels = parcels.filter(
              (p) => p.match_group_id === m.id && p.user_id === uid
            );
            const canCollect = userParcels.some((p) => p.can_collect);
            const st = userStatsMap[uid] || { completedTrips: 0, netRating: 0 };

            return {
              user_id: uid,
              is_me: isMe,
              name: u.name,
              block_wing: u.block_wing,
              room_number: u.room_number,
              is_verified: Boolean(u.is_verified),
              is_trusted: st.completedTrips >= 3 && st.netRating >= 0,
              completed_trips: st.completedTrips,
              // Phone number visible ONLY if user explicitly ticked share_phone in this match (or is me)
              phone: info.share_phone || isMe ? u.phone_normalized : null,
              share_phone: Boolean(info.share_phone),
              volunteer_choice: info.volunteer_choice || 'undecided',
              // Receiver sees ONLY their own 4-digit code; collector never sees receiver codes
              my_handover_code:
                isMe && m.collector_user_id !== currentUser.id ? info.handover_code : null,
              handed_over: Boolean(info.handed_over_at),
              can_collect: canCollect,
              // Privacy: strip item_name and order_id for anyone other than owner
              parcels: userParcels.map((p) => ({
                id: p.id,
                courier: p.courier,
                parcel_size: p.parcel_size,
                can_collect: p.can_collect,
                free_from: p.free_from,
                free_until: p.free_until,
                item_name: isMe ? p.item_name : null,
                order_id: isMe ? p.order_id : null,
              })),
            };
          });

        // Fair suggestion: fewest completed trips among members who can collect & haven't declined
        const eligible = memberList
          .filter((mem) => mem.can_collect && mem.volunteer_choice !== 'wont_collect')
          .sort(
            (a, b) =>
              a.completed_trips - b.completed_trips || a.name.localeCompare(b.name)
          );

        const myMember = memberList.find((mem) => mem.is_me);
        const myRatingDoc = ratings.find(
          (r) => r.match_group_id === m.id && r.rater_user_id === currentUser.id
        );

        return {
          ...m,
          collector_name: collector?.name || 'Someone',
          membersList: memberList,
          suggested_collector: eligible[0] || null,
          my_member: myMember,
          my_rating: myRatingDoc ? myRatingDoc.score : null,
        };
      });

    const dateRank = (d) => {
      if (d === today) return 0;
      if (d === tomorrow) return 1;
      if (d > tomorrow) return 2;
      return 3;
    };

    return relevant.sort(
      (a, b) =>
        dateRank(a.delivery_date) - dateRank(b.delivery_date) ||
        a.delivery_date.localeCompare(b.delivery_date)
    );
  }, [matches, parcels, usersById, userStatsMap, ratings, currentUser]);

  const activeMatchCount = useMemo(() => {
    const today = getTodayISO(0);
    return myMatches.filter((m) => m.delivery_date >= today || m.status !== 'collected').length;
  }, [myMatches]);

  // My Parcels list
  const myParcels = useMemo(() => {
    if (!currentUser) return [];
    const matchStatusMap = {};
    matches.forEach((m) => {
      matchStatusMap[m.id] = m.status;
    });

    return parcels
      .filter((p) => p.user_id === currentUser.id)
      .map((p) => ({
        ...p,
        match_status: p.match_group_id ? matchStatusMap[p.match_group_id] || null : null,
      }))
      .sort(
        (a, b) =>
          b.delivery_date.localeCompare(a.delivery_date) ||
          (b.created_at || 0) - (a.created_at || 0)
      );
  }, [parcels, matches, currentUser]);

  // Parcel Heroes Leaderboard
  const heroesList = useMemo(() => {
    return users
      .map((u) => {
        const st = userStatsMap[u.id] || {
          completedTrips: 0,
          studentsHelped: 0,
          monthTrips: 0,
          monthStudentsHelped: 0,
          netRating: 0,
        };
        const trips = heroPeriod === 'month' ? st.monthTrips : st.completedTrips;
        const helped = heroPeriod === 'month' ? st.monthStudentsHelped : st.studentsHelped;
        return {
          ...u,
          trips,
          helped,
          minutesSaved: helped * 40,
          is_trusted: st.completedTrips >= 3 && st.netRating >= 0,
        };
      })
      .filter((h) => h.trips > 0)
      .sort((a, b) => b.trips - a.trips || b.helped - a.helped || a.name.localeCompare(b.name));
  }, [users, userStatsMap, heroPeriod]);

  // ============================================================================
  // MATCH ACTIONS (VOLUNTEER, SHARE PHONE, COLLECT, HANDOVER, RATE, BLOCK, REPORT)
  // ============================================================================
  const handleVolunteer = async (match, choice) => {
    if (!currentUser) return;
    if (match.status === 'collected') return;

    if (choice === 'will_collect' && match.collector_user_id && match.collector_user_id !== currentUser.id) {
      showToast('Someone else has already volunteered to collect.', 'error');
      return;
    }

    try {
      const updates = {
        [`members.${currentUser.id}.volunteer_choice`]: choice,
      };
      if (choice === 'will_collect') {
        updates.collector_user_id = currentUser.id;
        updates.status = 'volunteer_assigned';
      } else if (match.collector_user_id === currentUser.id) {
        updates.collector_user_id = null;
        updates.status = 'needs_volunteer';
      }
      await updateDoc(publicDoc('matches', match.id), updates);
      showToast(
        choice === 'will_collect'
          ? "Awesome! You volunteered to collect everyone's parcels."
          : 'Updated your preference.',
        'success'
      );
    } catch (err) {
      showToast('Could not update volunteer status.', 'error');
    }
  };

  const handleToggleSharePhone = async (matchId, checked) => {
    if (!currentUser) return;
    try {
      await updateDoc(publicDoc('matches', matchId), {
        [`members.${currentUser.id}.share_phone`]: checked,
      });
      showToast(
        checked ? 'Phone shared with this match only.' : 'Phone hidden from this match.',
        'info'
      );
    } catch {
      showToast('Could not update phone sharing.', 'error');
    }
  };

  const handleMarkCollected = async (match, handoverSpot) => {
    const cleanSpot = handoverSpot.trim();
    if (cleanSpot.length < 2) {
      showToast('Please enter a clear handover spot (e.g., Block A-2 Lobby, 6 PM).', 'error');
      return;
    }
    try {
      const updatedMembers = { ...(match.members || {}) };
      Object.keys(updatedMembers).forEach((uid) => {
        if (uid === currentUser.id) {
          updatedMembers[uid] = {
            ...updatedMembers[uid],
            handed_over_at: Date.now(),
          };
        } else {
          updatedMembers[uid] = {
            ...updatedMembers[uid],
            handover_code: generateOTP(4),
          };
        }
      });

      await updateDoc(publicDoc('matches', match.id), {
        status: 'collected',
        handover_spot: cleanSpot.slice(0, 200),
        collected_at: Date.now(),
        members: updatedMembers,
      });
      showToast('Marked collected! Unique 4-digit handover codes issued to receivers.', 'success');
    } catch {
      showToast('Could not mark parcels as collected.', 'error');
    }
  };

  const handleConfirmHandover = async (match, receiverUid, enteredCode) => {
    const clean = String(enteredCode || '').trim();
    if (!/^\d{4}$/.test(clean)) {
      showToast('Please enter the 4-digit handover code.', 'error');
      return false;
    }
    const expectedCode = match.members?.[receiverUid]?.handover_code;
    if (clean !== expectedCode) {
      showToast('Incorrect 4-digit code. Ask the receiver to read their code again.', 'error');
      return false;
    }
    try {
      await updateDoc(publicDoc('matches', match.id), {
        [`members.${receiverUid}.handed_over_at`]: Date.now(),
      });
      showToast('Handover confirmed! Walking trip saved.', 'success');
      return true;
    } catch {
      showToast('Could not confirm handover.', 'error');
      return false;
    }
  };

  const handleRateCollector = async (match, score) => {
    if (!currentUser || !match.collector_user_id) return;
    try {
      const ratingId = `${match.id}_${currentUser.id}`;
      await setDoc(publicDoc('ratings', ratingId), {
        match_group_id: match.id,
        rater_user_id: currentUser.id,
        collector_user_id: match.collector_user_id,
        score,
        created_at: Date.now(),
      });
      showToast('Thanks for rating your collector!', 'success');
    } catch {
      showToast('Could not save rating.', 'error');
    }
  };

  const handleBlockUser = async (targetUser) => {
    if (!currentUser) return;
    try {
      await setDoc(publicDoc('blocks', `${currentUser.id}_${targetUser.id}`), {
        blocker_id: currentUser.id,
        blocked_id: targetUser.id,
        created_at: Date.now(),
      });

      // Re-sync all upcoming dates where currentUser has parcels
      const today = getTodayISO(0);
      const uniqueDates = new Map();
      parcels
        .filter((p) => p.user_id === currentUser.id && p.delivery_date >= today)
        .forEach((p) => uniqueDates.set(`${p.campus}__${p.delivery_date}`, p));

      for (const p of uniqueDates.values()) {
        await syncMatchesForDate(p.campus, p.delivery_date);
      }

      setModal(null);
      showToast(`${targetUser.name} blocked. Matches updated.`, 'success');
    } catch {
      showToast('Could not block user.', 'error');
    }
  };

  const handleReportUser = async (targetUser, matchId, reason) => {
    const clean = reason.trim();
    if (clean.length < 5) {
      showToast('Please describe the issue (at least 5 characters).', 'error');
      return;
    }
    try {
      await addDoc(publicCol('reports'), {
        reporter_id: currentUser.id,
        reporter_name: currentUser.name,
        reporter_block: currentUser.block_wing,
        reported_user_id: targetUser.id,
        reported_name: targetUser.name,
        reported_block: targetUser.block_wing,
        match_group_id: matchId || null,
        reason: clean.slice(0, 600),
        status: 'open',
        created_at: Date.now(),
      });
      setModal(null);
      showToast('Report submitted privately to the admin.', 'success');
    } catch {
      showToast('Could not submit report.', 'error');
    }
  };

  const handleDeleteParcel = async (parcel) => {
    if (deleteConfirmId !== parcel.id) {
      setDeleteConfirmId(parcel.id);
      if (deleteTimerRef.current) clearTimeout(deleteTimerRef.current);
      deleteTimerRef.current = setTimeout(() => setDeleteConfirmId(null), 4000);
      return;
    }
    if (deleteTimerRef.current) clearTimeout(deleteTimerRef.current);
    setDeleteConfirmId(null);
    try {
      await deleteDoc(publicDoc('parcels', parcel.id));
      await syncMatchesForDate(parcel.campus, parcel.delivery_date);
      showToast('Parcel deleted and matches updated.', 'success');
    } catch {
      showToast('Could not delete parcel.', 'error');
    }
  };

  // Seed 2 demo hostel mates on current user's campus for Today & Tomorrow
  const handleSeedDemoMates = async () => {
    if (!currentUser) return;
    setSeedingDemo(true);
    try {
      const today = getTodayISO(0);
      const tomorrow = getTodayISO(1);

      const demoSpecs = [
        {
          name: 'Aarav Patel',
          block_wing: 'A-2',
          room_number: '214',
          phone_normalized: '+919000000001',
          campus: currentUser.campus,
          email: 'aarav.demo@vitbhopal.ac.in',
          courier: 'Amazon',
          parcel_size: 'Small',
          can_collect: true,
          free_from: '16:00',
          free_until: '18:00',
        },
        {
          name: 'Diya Nair',
          block_wing: 'B-1',
          room_number: '108',
          phone_normalized: '+919000000002',
          campus: currentUser.campus,
          email: 'diya.demo@vitbhopal.ac.in',
          courier: 'Flipkart',
          parcel_size: 'Medium',
          can_collect: false,
          free_from: null,
          free_until: null,
        },
      ];

      for (const spec of demoSpecs) {
        let userId = users.find((u) => u.phone_normalized === spec.phone_normalized)?.id;
        if (!userId) {
          const ref = await addDoc(publicCol('users'), {
            name: spec.name,
            block_wing: spec.block_wing,
            room_number: spec.room_number,
            phone_normalized: spec.phone_normalized,
            campus: spec.campus,
            email: spec.email,
            email_verified: true,
            is_verified: true,
            is_admin: false,
            is_demo: true,
            created_at: Date.now(),
            updated_at: Date.now(),
          });
          userId = ref.id;
        }

        for (const dDate of [today, tomorrow]) {
          const exists = parcels.some(
            (p) => p.user_id === userId && p.delivery_date === dDate
          );
          if (!exists) {
            await addDoc(publicCol('parcels'), {
              user_id: userId,
              campus: spec.campus,
              delivery_date: dDate,
              courier: spec.courier,
              parcel_size: spec.parcel_size,
              item_name: 'Demo item (private)',
              time_slot: '2 PM - 6 PM',
              order_id: 'DEMO991',
              can_collect: spec.can_collect,
              free_from: spec.free_from,
              free_until: spec.free_until,
              match_group_id: null,
              created_at: Date.now(),
              updated_at: Date.now(),
            });
          }
        }
      }

      await syncMatchesForDate(currentUser.campus, today);
      await syncMatchesForDate(currentUser.campus, tomorrow);
      showToast(
        'Demo hostel mates added for Today & Tomorrow! Add a parcel for Today to see an instant match.',
        'success'
      );
    } catch (err) {
      console.error(err);
      showToast('Could not add demo hostel mates.', 'error');
    } finally {
      setSeedingDemo(false);
    }
  };

  const shareMatchUpdate = (match, channel = 'whatsapp') => {
    let text = `ProParcel Update (${formatDateLabel(match.delivery_date)} - ${match.campus}): `;
    if (match.status === 'collected') {
      text += `${match.collector_name} collected everyone's parcels! Pickup spot: ${match.handover_spot}. Check ProParcel for your 4-digit handover code.`;
    } else if (match.status === 'volunteer_assigned') {
      text += `${match.collector_name} volunteered to collect parcels for our ${match.membersList.length}-student match!`;
    } else {
      text += `We have a ${match.membersList.length}-student parcel match! Open ProParcel to choose who collects.`;
    }

    if (channel === 'whatsapp') {
      window.open(`https://wa.me/?text=${encodeURIComponent(text)}`, '_blank', 'noopener');
    } else {
      window.open(
        `mailto:?subject=${encodeURIComponent('ProParcel Match Update')}&body=${encodeURIComponent(text)}`,
        '_blank'
      );
    }
  };

  // ============================================================================
  // THEME CLASSES
  // ============================================================================
  const theme = darkMode
    ? {
        bg: 'bg-slate-950 text-slate-100',
        card: 'bg-slate-900 border-slate-800',
        subCard: 'bg-slate-950/70 border-slate-800',
        input: 'bg-slate-950 border-slate-700 text-slate-100 placeholder-slate-500 focus:border-indigo-400',
        muted: 'text-slate-400',
        accentText: 'text-indigo-400',
        accentBg: 'bg-indigo-500 hover:bg-indigo-600 text-white',
        accentSoft: 'bg-indigo-500/15 text-indigo-300 border-indigo-500/30',
        secondaryBtn: 'bg-slate-800 hover:bg-slate-700 text-slate-100 border-slate-700',
        navBg: 'bg-slate-900/95 border-slate-800',
        noticeBg: 'bg-indigo-950/50 border-indigo-500/40 text-indigo-100',
      }
    : {
        bg: 'bg-slate-50 text-slate-900',
        card: 'bg-white border-slate-200 shadow-sm',
        subCard: 'bg-slate-50 border-slate-200',
        input: 'bg-slate-50 border-slate-300 text-slate-900 placeholder-slate-400 focus:border-indigo-600',
        muted: 'text-slate-500',
        accentText: 'text-indigo-600',
        accentBg: 'bg-indigo-600 hover:bg-indigo-700 text-white',
        accentSoft: 'bg-indigo-50 text-indigo-700 border-indigo-200',
        secondaryBtn: 'bg-slate-100 hover:bg-slate-200 text-slate-800 border-slate-200',
        navBg: 'bg-white/95 border-slate-200',
        noticeBg: 'bg-indigo-50 border-indigo-300 text-indigo-950',
      };

  // ============================================================================
  // RENDER SHELL
  // ============================================================================
  if (!authReady || !prefsLoaded) {
    return (
      <div className={`min-h-screen flex items-center justify-center p-6 ${theme.bg}`}>
        <div className={`w-full max-w-md rounded-2xl border p-8 text-center ${theme.card}`}>
          <div className="text-2xl font-extrabold tracking-tight mb-2">
            Pro<span className={theme.accentText}>Parcel</span>
          </div>
          <p className={`text-sm ${theme.muted}`}>Connecting to campus parcel board...</p>
        </div>
      </div>
    );
  }

  return (
    <div className={`min-h-screen flex flex-col transition-colors duration-200 ${theme.bg}`}>
      {/* Centered Mobile-First Container */}
      <div className="w-full max-w-[520px] mx-auto flex-1 flex flex-col pb-24">
        {/* Top Bar */}
        <header
          className={`sticky top-0 z-20 flex items-center justify-between px-4 py-3 border-b backdrop-blur ${theme.navBg}`}
        >
          <div className="flex items-center gap-2">
            <div className="w-9 h-9 rounded-xl bg-indigo-600 text-white flex items-center justify-center shadow-sm">
              <Package className="w-5 h-5" />
            </div>
            <div className="text-xl font-extrabold tracking-tight">
              Pro<span className={theme.accentText}>Parcel</span>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {adminReturnId && currentUser?.is_demo && (
              <button
                onClick={() => loginAsProfile(adminReturnId, null)}
                className="min-h-[40px] px-3 rounded-xl bg-amber-500 text-white text-xs font-bold flex items-center gap-1 shadow-sm"
              >
                <RefreshCw className="w-3.5 h-3.5" />
                Back to Admin
              </button>
            )}
            <button
              onClick={toggleDarkMode}
              aria-label="Toggle theme"
              className={`min-w-[44px] min-h-[44px] rounded-xl border flex items-center justify-center transition ${theme.secondaryBtn}`}
            >
              {darkMode ? <Sun className="w-5 h-5" /> : <Moon className="w-5 h-5" />}
            </button>
            {currentUser && (
              <button
                onClick={() => setModal({ type: 'profile' })}
                aria-label="Profile"
                className={`min-w-[44px] min-h-[44px] rounded-xl border flex items-center justify-center transition ${theme.secondaryBtn}`}
              >
                <User className="w-5 h-5" />
              </button>
            )}
          </div>
        </header>

        {/* Demo Mode Indicator Banner */}
        {adminReturnId && currentUser?.is_demo && (
          <div className="mx-3 mt-3 px-3.5 py-2.5 rounded-xl bg-amber-500/15 border border-amber-500/40 text-amber-600 dark:text-amber-300 text-xs font-semibold flex items-center justify-between gap-2">
            <span>Testing view as demo mate: {currentUser.name}</span>
            <button
              onClick={() => loginAsProfile(adminReturnId, null)}
              className="underline font-bold"
            >
              Exit test view
            </button>
          </div>
        )}

        {/* Toast Notification */}
        {toast && (
          <div className="fixed top-16 left-1/2 -translate-x-1/2 w-[calc(100%-24px)] max-w-[496px] z-50">
            <div
              className={`px-4 py-3 rounded-xl shadow-lg text-sm font-semibold text-white flex items-center justify-between gap-3 ${
                toast.type === 'error'
                  ? 'bg-rose-600'
                  : toast.type === 'success'
                  ? 'bg-emerald-600'
                  : 'bg-slate-900 dark:bg-indigo-600'
              }`}
            >
              <span>{toast.message}</span>
              <button onClick={() => setToast(null)} className="opacity-80 hover:opacity-100">
                <X className="w-4 h-4" />
              </button>
            </div>
          </div>
        )}

        {/* Main Content Area */}
        <main className="flex-1 p-3.5 space-y-3.5">
          {!currentUser ? (
            <AuthView
              theme={theme}
              settings={settings}
              users={users}
              showToast={showToast}
              onAuthSuccess={(profileId) => loginAsProfile(profileId, null)}
            />
          ) : (
            <>
              {activeTab === 'matches' && (
                <MatchesView
                  theme={theme}
                  currentUser={currentUser}
                  settings={settings}
                  guideDismissed={guideDismissed}
                  onDismissGuide={dismissGuide}
                  myMatches={myMatches}
                  activeMatchCount={activeMatchCount}
                  walkingStats={walkingStats}
                  onGoAdd={() => {
                    setEditingParcel(null);
                    setActiveTab('add');
                  }}
                  onSeedDemo={handleSeedDemoMates}
                  seedingDemo={seedingDemo}
                  onVolunteer={handleVolunteer}
                  onToggleSharePhone={handleToggleSharePhone}
                  onMarkCollected={handleMarkCollected}
                  onConfirmHandover={handleConfirmHandover}
                  onRateCollector={handleRateCollector}
                  onShareUpdate={shareMatchUpdate}
                  onOpenReport={(mem, matchId) =>
                    setModal({ type: 'report', data: { user: mem, matchId } })
                  }
                  onOpenBlock={(mem) => setModal({ type: 'block', data: { user: mem } })}
                />
              )}

              {activeTab === 'add' && (
                <AddParcelView
                  theme={theme}
                  currentUser={currentUser}
                  editingParcel={editingParcel}
                  showToast={showToast}
                  onDone={(nextTab) => {
                    setEditingParcel(null);
                    setActiveTab(nextTab);
                  }}
                />
              )}

              {activeTab === 'mine' && (
                <MyParcelsView
                  theme={theme}
                  currentUser={currentUser}
                  myParcels={myParcels}
                  deleteConfirmId={deleteConfirmId}
                  onEdit={(p) => {
                    setEditingParcel(p);
                    setActiveTab('add');
                  }}
                  onDelete={handleDeleteParcel}
                  onOpenGuide={() => setModal({ type: 'guide' })}
                  showToast={showToast}
                />
              )}

              {activeTab === 'heroes' && (
                <HeroesView
                  theme={theme}
                  heroes={heroesList}
                  heroPeriod={heroPeriod}
                  setHeroPeriod={setHeroPeriod}
                  walkingStats={walkingStats}
                />
              )}

              {activeTab === 'admin' && currentUser.is_admin && (
                <AdminView
                  theme={theme}
                  currentUser={currentUser}
                  settings={settings}
                  users={users}
                  parcels={parcels}
                  matches={matches}
                  reports={reports}
                  feedbackList={feedbackList}
                  showToast={showToast}
                  onSeedDemo={handleSeedDemoMates}
                  seedingDemo={seedingDemo}
                  onImpersonateDemo={(demoId) => loginAsProfile(demoId, currentUser.id)}
                />
              )}
            </>
          )}
        </main>

        {/* Required Persistent Footer */}
        <footer className={`px-4 pt-3 pb-6 text-center text-xs ${theme.muted}`}>
          ProParcel is an independent student project, not an official college service.
        </footer>
      </div>

      {/* Bottom Navigation Bar (Signed-in only) */}
      {currentUser && (
        <nav
          className={`fixed bottom-0 left-1/2 -translate-x-1/2 w-full max-w-[520px] border-t backdrop-blur z-30 flex items-center justify-around px-1 py-1.5 ${theme.navBg}`}
          aria-label="Main navigation"
        >
          {[
            { id: 'matches', label: 'Matches', icon: Users },
            { id: 'add', label: 'Add parcel', icon: PlusCircle },
            { id: 'mine', label: 'My parcels', icon: Package },
            { id: 'heroes', label: 'Heroes', icon: Trophy },
            ...(currentUser.is_admin ? [{ id: 'admin', label: 'Admin', icon: Shield }] : []),
          ].map((item) => {
            const Icon = item.icon;
            const active = activeTab === item.id;
            return (
              <button
                key={item.id}
                onClick={() => {
                  setEditingParcel(null);
                  setActiveTab(item.id);
                }}
                className={`flex-1 min-h-[50px] flex flex-col items-center justify-center gap-0.5 rounded-xl text-[11px] font-semibold transition ${
                  active ? theme.accentText : theme.muted
                }`}
              >
                <Icon className={`w-5 h-5 ${active ? 'stroke-[2.5]' : ''}`} />
                <span>{item.label}</span>
              </button>
            );
          })}
        </nav>
      )}

      {/* Custom In-App Modals */}
      {modal && (
        <div
          className="fixed inset-0 z-50 bg-black/60 backdrop-blur-[2px] flex items-end sm:items-center justify-center p-3"
          onClick={(e) => {
            if (e.target === e.currentTarget) setModal(null);
          }}
        >
          <div
            className={`w-full max-w-[460px] max-h-[88vh] overflow-y-auto rounded-2xl border p-5 space-y-4 ${theme.card}`}
          >
            {modal.type === 'profile' && currentUser && (
              <ProfileModal
                theme={theme}
                user={currentUser}
                stats={userStatsMap[currentUser.id] || { completedTrips: 0, netRating: 0 }}
                isTrusted={isUserTrusted(currentUser.id)}
                onClose={() => setModal(null)}
                onSignOut={handleSignOut}
                showToast={showToast}
              />
            )}

            {modal.type === 'guide' && (
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <h3 className="text-lg font-bold">How ProParcel works</h3>
                  <button
                    onClick={() => setModal(null)}
                    className={`min-w-[40px] min-h-[40px] rounded-xl border flex items-center justify-center ${theme.secondaryBtn}`}
                  >
                    <X className="w-5 h-5" />
                  </button>
                </div>
                <HowItWorksSteps theme={theme} />
                <button
                  onClick={() => setModal(null)}
                  className={`w-full min-h-[46px] rounded-xl font-semibold ${theme.accentBg}`}
                >
                  Got it
                </button>
              </div>
            )}

            {modal.type === 'block' && (
              <div className="space-y-4">
                <h3 className="text-lg font-bold">Block {modal.data.user.name}?</h3>
                <p className={`text-sm ${theme.muted}`}>
                  You will never be matched with this student again, and any current upcoming match
                  between you will be separated immediately.
                </p>
                <div className="space-y-2">
                  <button
                    onClick={() => handleBlockUser({ id: modal.data.user.user_id, name: modal.data.user.name })}
                    className="w-full min-h-[46px] rounded-xl bg-rose-600 hover:bg-rose-700 text-white font-semibold"
                  >
                    Yes, block user
                  </button>
                  <button
                    onClick={() => setModal(null)}
                    className={`w-full min-h-[46px] rounded-xl border font-semibold ${theme.secondaryBtn}`}
                  >
                    Cancel
                  </button>
                </div>
              </div>
            )}

            {modal.type === 'report' && (
              <ReportModal
                theme={theme}
                targetUser={modal.data.user}
                matchId={modal.data.matchId}
                onSubmit={handleReportUser}
                onClose={() => setModal(null)}
              />
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ============================================================================
// COMPONENT: 4-STEP HOW IT WORKS LIST
// ============================================================================
function HowItWorksSteps({ theme }) {
  const steps = [
    'Upload your order screenshot (or enter details) to log your delivery date.',
    'We automatically group students on your campus whose parcels arrive the same day.',
    'One volunteer collects for everyone and posts the pickup spot in the app.',
    'Share your private 4-digit handover code at pickup and rate your collector.',
  ];
  return (
    <ol className="space-y-2.5">
      {steps.map((text, idx) => (
        <li key={idx} className="flex items-start gap-2.5 text-sm">
          <span className="w-6 h-6 shrink-0 rounded-full bg-indigo-600 text-white text-xs font-bold flex items-center justify-center mt-0.5">
            {idx + 1}
          </span>
          <span className={theme.muted}>{text}</span>
        </li>
      ))}
    </ol>
  );
}

// ============================================================================
// COMPONENT: AUTH VIEW (SIGN UP ONCE + LOG IN WITH 6-DIGIT OTP)
// ============================================================================
function AuthView({ theme, settings, users, showToast, onAuthSuccess }) {
  const [mode, setMode] = useState('signup'); // 'signup' | 'login'
  const [step, setStep] = useState('form'); // 'form' | 'otp'
  const [name, setName] = useState('');
  const [blockWing, setBlockWing] = useState('');
  const [roomNumber, setRoomNumber] = useState('');
  const [campus, setCampus] = useState(DEFAULT_CAMPUS);
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [inviteCode, setInviteCode] = useState('');

  const [generatedOtp, setGeneratedOtp] = useState('');
  const [enteredOtp, setEnteredOtp] = useState('');
  const [pendingUser, setPendingUser] = useState(null);
  const [submitting, setSubmitting] = useState(false);

  const inviteRequired = Boolean(settings.invite_code && settings.invite_code.trim());

  const handleRequestSignupOtp = (e) => {
    e.preventDefault();
    if (name.trim().length < 2) return showToast('Please enter your full name.', 'error');
    if (!blockWing.trim()) return showToast('Enter your hostel block & wing (e.g. A-2).', 'error');
    if (!roomNumber.trim()) return showToast('Enter your room number.', 'error');

    const normalized = normalizePhone(phone);
    if (!normalized) return showToast('Please enter a valid 10-digit phone number.', 'error');

    if (inviteRequired && inviteCode.trim() !== settings.invite_code.trim()) {
      return showToast('Invalid invite code. Ask your campus admin.', 'error');
    }

    // Strict duplicate check with generic error message (never reveal whose number it is)
    const exists = users.some((u) => u.phone_normalized === normalized);
    if (exists) {
      return showToast("This phone number can't be used", 'error');
    }

    if (email.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
      return showToast('Please enter a valid college email address.', 'error');
    }

    const code = generateOTP(6);
    setGeneratedOtp(code);
    setEnteredOtp('');
    setPendingUser({
      name: name.trim().slice(0, 100),
      block_wing: blockWing.trim().slice(0, 30),
      room_number: roomNumber.trim().slice(0, 20),
      campus: campus.trim().slice(0, 100) || DEFAULT_CAMPUS,
      phone_normalized: normalized,
      email: email.trim().toLowerCase().slice(0, 150),
    });
    setStep('otp');
    showToast('6-digit test OTP generated below.', 'success');
  };

  const handleRequestLoginOtp = (e) => {
    e.preventDefault();
    const normalized = normalizePhone(phone);
    if (!normalized) return showToast('Please enter a valid phone number.', 'error');

    const found = users.find((u) => u.phone_normalized === normalized);
    const code = generateOTP(6);
    setGeneratedOtp(code);
    setEnteredOtp('');
    setPendingUser(found || { notFound: true, phone_normalized: normalized });
    setStep('otp');
    showToast('If this number is registered, your 6-digit OTP is ready.', 'info');
  };

  const handleVerifyOtp = async (e) => {
    e.preventDefault();
    if (enteredOtp.trim() !== generatedOtp) {
      return showToast('Incorrect 6-digit OTP code. Please try again.', 'error');
    }

    setSubmitting(true);
    try {
      if (mode === 'login') {
        if (!pendingUser || pendingUser.notFound) {
          showToast('No account found for that number. Please sign up first.', 'error');
          setStep('form');
          return;
        }
        showToast(`Welcome back, ${pendingUser.name}!`, 'success');
        await onAuthSuccess(pendingUser.id);
      } else {
        // Re-check duplicate right before creating
        const snap = await getDocs(publicCol('users'));
        const allUsers = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
        if (allUsers.some((u) => u.phone_normalized === pendingUser.phone_normalized)) {
          showToast("This phone number can't be used", 'error');
          setStep('form');
          return;
        }

        // First real user automatically becomes Admin
        const isFirstUser = allUsers.filter((u) => !u.is_demo).length === 0;

        const docRef = await addDoc(publicCol('users'), {
          ...pendingUser,
          email_verified: false,
          is_verified: isFirstUser,
          is_admin: isFirstUser,
          is_demo: false,
          created_at: Date.now(),
          updated_at: Date.now(),
        });

        // Seed global settings if first launch
        if (isFirstUser) {
          await setDoc(
            publicDoc('settings', 'global'),
            { invite_code: '', parcel_notice: DEFAULT_NOTICE },
            { merge: true }
          );
        }

        showToast(
          isFirstUser
            ? `Welcome, ${pendingUser.name}! You're the first member — Admin tab unlocked.`
            : `Welcome to ProParcel, ${pendingUser.name}!`,
          'success'
        );
        await onAuthSuccess(docRef.id);
      }
    } catch (err) {
      console.error(err);
      showToast('Could not complete verification. Please try again.', 'error');
    } finally {
      setSubmitting(false);
    }
  };

  if (step === 'otp') {
    return (
      <div className={`rounded-2xl border p-5 space-y-4 ${theme.card}`}>
        <div>
          <h2 className="text-lg font-bold">Verify your phone</h2>
          <p className={`text-sm mt-1 ${theme.muted}`}>
            Enter the 6-digit verification code for{' '}
            <strong className="text-inherit">{pendingUser?.phone_normalized}</strong>.
          </p>
        </div>

        <div className={`rounded-xl border px-3.5 py-3 text-sm ${theme.accentSoft}`}>
          <div className="text-xs font-semibold opacity-80">Test OTP (no SMS gateway needed)</div>
          <div className="text-2xl font-extrabold tracking-[0.22em] mt-0.5">{generatedOtp}</div>
        </div>

        <form onSubmit={handleVerifyOtp} className="space-y-3">
          <div>
            <label className="block text-xs font-semibold mb-1.5">6-digit OTP</label>
            <input
              type="tel"
              inputMode="numeric"
              maxLength={6}
              value={enteredOtp}
              onChange={(e) => setEnteredOtp(e.target.value.replace(/\D/g, ''))}
              placeholder="Enter 6 digits"
              required
              className={`w-full min-h-[46px] px-3.5 rounded-xl border text-base tracking-widest font-bold outline-none ${theme.input}`}
            />
          </div>
          <button
            type="submit"
            disabled={submitting}
            className={`w-full min-h-[46px] rounded-xl font-semibold disabled:opacity-60 ${theme.accentBg}`}
          >
            {submitting ? 'Verifying...' : 'Verify & Continue'}
          </button>
          <button
            type="button"
            onClick={() => setStep('form')}
            className={`w-full min-h-[44px] rounded-xl border font-semibold ${theme.secondaryBtn}`}
          >
            Go back
          </button>
        </form>
      </div>
    );
  }

  return (
    <div className="space-y-3.5">
      {/* Hero Banner */}
      <div className="rounded-2xl bg-gradient-to-br from-indigo-600 to-indigo-700 text-white p-5 shadow-md space-y-2">
        <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-white/15 text-xs font-semibold">
          <Sparkles className="w-3.5 h-3.5" /> Save the 40-min parcel-room walk
        </div>
        <h1 className="text-xl font-extrabold leading-snug">
          One trip for everyone&apos;s hostel parcels.
        </h1>
        <p className="text-sm text-indigo-100">
          Match with hostel mates whose deliveries arrive the same day so only one person goes to
          the parcel desk.
        </p>
      </div>

      {/* Sign Up / Log In Card */}
      <div className={`rounded-2xl border p-4 space-y-4 ${theme.card}`}>
        <div className={`grid grid-cols-2 p-1 rounded-xl border ${theme.subCard}`}>
          <button
            type="button"
            onClick={() => setMode('signup')}
            className={`min-h-[40px] rounded-lg text-sm font-bold transition ${
              mode === 'signup' ? 'bg-indigo-600 text-white shadow-sm' : theme.muted
            }`}
          >
            Sign up (once)
          </button>
          <button
            type="button"
            onClick={() => setMode('login')}
            className={`min-h-[40px] rounded-lg text-sm font-bold transition ${
              mode === 'login' ? 'bg-indigo-600 text-white shadow-sm' : theme.muted
            }`}
          >
            Log in
          </button>
        </div>

        {mode === 'signup' ? (
          <form onSubmit={handleRequestSignupOtp} className="space-y-3">
            <div>
              <label className="block text-xs font-semibold mb-1">Full name</label>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. Rohan Verma"
                required
                className={`w-full min-h-[46px] px-3.5 rounded-xl border text-sm outline-none ${theme.input}`}
              />
            </div>

            <div className="grid grid-cols-2 gap-2.5">
              <div>
                <label className="block text-xs font-semibold mb-1">Hostel block &amp; wing</label>
                <input
                  type="text"
                  value={blockWing}
                  onChange={(e) => setBlockWing(e.target.value)}
                  placeholder="e.g. A-2"
                  required
                  className={`w-full min-h-[46px] px-3.5 rounded-xl border text-sm outline-none ${theme.input}`}
                />
              </div>
              <div>
                <label className="block text-xs font-semibold mb-1">Room number</label>
                <input
                  type="text"
                  value={roomNumber}
                  onChange={(e) => setRoomNumber(e.target.value)}
                  placeholder="e.g. 304"
                  required
                  className={`w-full min-h-[46px] px-3.5 rounded-xl border text-sm outline-none ${theme.input}`}
                />
              </div>
            </div>

            <div>
              <label className="block text-xs font-semibold mb-1">Campus</label>
              <input
                type="text"
                value={campus}
                onChange={(e) => setCampus(e.target.value)}
                required
                className={`w-full min-h-[46px] px-3.5 rounded-xl border text-sm outline-none ${theme.input}`}
              />
            </div>

            <div>
              <label className="block text-xs font-semibold mb-1">Phone number</label>
              <input
                type="tel"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                placeholder="10-digit mobile number"
                required
                className={`w-full min-h-[46px] px-3.5 rounded-xl border text-sm outline-none ${theme.input}`}
              />
              <p className={`text-xs mt-1.5 flex items-start gap-1.5 ${theme.muted}`}>
                <Lock className="w-3.5 h-3.5 shrink-0 mt-0.5 text-indigo-500" />
                <span>
                  Don&apos;t worry, it&apos;s confidential. Your number will not be shared without
                  your permission.
                </span>
              </p>
            </div>

            <div>
              <label className="block text-xs font-semibold mb-1">
                College email <span className={`font-normal ${theme.muted}`}>(optional)</span>
              </label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="name@vitbhopal.ac.in"
                className={`w-full min-h-[46px] px-3.5 rounded-xl border text-sm outline-none ${theme.input}`}
              />
            </div>

            {inviteRequired && (
              <div>
                <label className="block text-xs font-semibold mb-1">Invite code (required)</label>
                <input
                  type="text"
                  value={inviteCode}
                  onChange={(e) => setInviteCode(e.target.value)}
                  placeholder="Enter campus invite code"
                  required
                  className={`w-full min-h-[46px] px-3.5 rounded-xl border text-sm outline-none ${theme.input}`}
                />
              </div>
            )}

            <button
              type="submit"
              className={`w-full min-h-[48px] rounded-xl font-bold text-sm shadow-sm ${theme.accentBg}`}
            >
              Send Verification OTP
            </button>
          </form>
        ) : (
          <form onSubmit={handleRequestLoginOtp} className="space-y-3">
            <div>
              <label className="block text-xs font-semibold mb-1">Phone number</label>
              <input
                type="tel"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                placeholder="Your registered mobile number"
                required
                className={`w-full min-h-[46px] px-3.5 rounded-xl border text-sm outline-none ${theme.input}`}
              />
              <p className={`text-xs mt-1.5 flex items-start gap-1.5 ${theme.muted}`}>
                <Lock className="w-3.5 h-3.5 shrink-0 mt-0.5 text-indigo-500" />
                <span>
                  Don&apos;t worry, it&apos;s confidential. Your number will not be shared without
                  your permission.
                </span>
              </p>
            </div>
            <button
              type="submit"
              className={`w-full min-h-[48px] rounded-xl font-bold text-sm shadow-sm ${theme.accentBg}`}
            >
              Send Login OTP
            </button>
          </form>
        )}
      </div>
    </div>
  );
}

// ============================================================================
// COMPONENT: MATCHES VIEW (HOME SCREEN)
// ============================================================================
function MatchesView({
  theme,
  currentUser,
  settings,
  guideDismissed,
  onDismissGuide,
  myMatches,
  activeMatchCount,
  walkingStats,
  onGoAdd,
  onSeedDemo,
  seedingDemo,
  onVolunteer,
  onToggleSharePhone,
  onMarkCollected,
  onConfirmHandover,
  onRateCollector,
  onShareUpdate,
  onOpenReport,
  onOpenBlock,
}) {
  return (
    <div className="space-y-3.5">
      {/* Parcel-room timings/notice set by Admin */}
      {settings.parcel_notice && (
        <div className={`rounded-2xl border-l-4 border px-3.5 py-3 text-sm ${theme.noticeBg}`}>
          <div className="font-bold text-xs uppercase tracking-wide opacity-80 mb-0.5">
            Parcel Room Notice
          </div>
          <div>{settings.parcel_notice}</div>
        </div>
      )}

      {/* Dismissible First-Visit "How it works" Card */}
      {!guideDismissed && (
        <div className={`rounded-2xl border p-4 space-y-3 ${theme.card}`}>
          <div className="flex items-center justify-between">
            <h3 className="font-bold text-base">How ProParcel works</h3>
            <button
              onClick={onDismissGuide}
              className={`min-h-[36px] px-3 rounded-lg border text-xs font-semibold ${theme.secondaryBtn}`}
            >
              Got it
            </button>
          </div>
          <HowItWorksSteps theme={theme} />
        </div>
      )}

      {/* Matches Banner + Walking Time Saved Counter */}
      <div className="rounded-2xl bg-gradient-to-br from-indigo-600 to-indigo-700 text-white p-4 shadow-md space-y-3">
        <div className="flex items-start justify-between gap-2">
          <div>
            <h2 className="text-lg font-extrabold">
              You have {activeMatchCount} parcel {activeMatchCount === 1 ? 'match' : 'matches'}
            </h2>
            <p className="text-xs text-indigo-100 mt-0.5">{currentUser.campus}</p>
          </div>
          <span className="px-2.5 py-1 rounded-full bg-white/15 text-xs font-semibold shrink-0">
            {currentUser.block_wing} · {currentUser.room_number}
          </span>
        </div>

        <div className="grid grid-cols-2 gap-2 pt-1">
          <div className="rounded-xl bg-white/15 px-3 py-2">
            <div className="text-[11px] text-indigo-100 flex items-center gap-1">
              <Clock className="w-3.5 h-3.5" /> Campus time saved
            </div>
            <div className="text-base font-extrabold">
              {formatMinutes(walkingStats.campusMinutesSaved)}
            </div>
          </div>
          <div className="rounded-xl bg-white/15 px-3 py-2">
            <div className="text-[11px] text-indigo-100 flex items-center gap-1">
              <Sparkles className="w-3.5 h-3.5" /> You saved
            </div>
            <div className="text-base font-extrabold">
              {formatMinutes(walkingStats.myMinutesSaved)}
            </div>
          </div>
        </div>
      </div>

      {/* Match Cards */}
      {myMatches.length === 0 ? (
        <div className={`rounded-2xl border p-6 text-center space-y-3 ${theme.card}`}>
          <div className="w-12 h-12 rounded-2xl bg-indigo-500/15 text-indigo-500 mx-auto flex items-center justify-center">
            <Users className="w-6 h-6" />
          </div>
          <h3 className="font-bold text-base">No parcel matches yet</h3>
          <p className={`text-sm ${theme.muted}`}>
            Add an upcoming parcel and we&apos;ll match you with hostel mates at{' '}
            <strong>{currentUser.campus}</strong> receiving parcels on the same date.
          </p>
          <div className="flex flex-col sm:flex-row gap-2 justify-center pt-1">
            <button
              type="button"
              onClick={onGoAdd}
              className={`min-h-[46px] px-5 rounded-xl font-semibold text-sm inline-flex items-center justify-center gap-2 ${theme.accentBg}`}
            >
              <PlusCircle className="w-4 h-4" /> Add a parcel
            </button>
            <button
              type="button"
              onClick={onSeedDemo}
              disabled={seedingDemo}
              className={`min-h-[46px] px-4 rounded-xl border font-semibold text-xs inline-flex items-center justify-center gap-1.5 ${theme.secondaryBtn}`}
            >
              <UserPlus className="w-4 h-4" />
              {seedingDemo ? 'Adding demo mates...' : 'Seed demo mates to test'}
            </button>
          </div>
        </div>
      ) : (
        myMatches.map((match) => (
          <MatchCard
            key={match.id}
            theme={theme}
            match={match}
            currentUser={currentUser}
            onVolunteer={onVolunteer}
            onToggleSharePhone={onToggleSharePhone}
            onMarkCollected={onMarkCollected}
            onConfirmHandover={onConfirmHandover}
            onRateCollector={onRateCollector}
            onShareUpdate={onShareUpdate}
            onOpenReport={onOpenReport}
            onOpenBlock={onOpenBlock}
          />
        ))
      )}
    </div>
  );
}

function MatchCard({
  theme,
  match,
  currentUser,
  onVolunteer,
  onToggleSharePhone,
  onMarkCollected,
  onConfirmHandover,
  onRateCollector,
  onShareUpdate,
  onOpenReport,
  onOpenBlock,
}) {
  const [spotInput, setSpotInput] = useState('');
  const [codeInputs, setCodeInputs] = useState({});

  const isCollector = match.collector_user_id === currentUser.id;
  const me = match.my_member;

  const statusPill =
    match.status === 'collected' ? (
      <span className="px-2.5 py-1 rounded-full text-xs font-bold bg-emerald-500/15 text-emerald-600 dark:text-emerald-400">
        Collected
      </span>
    ) : match.status === 'volunteer_assigned' ? (
      <span className={`px-2.5 py-1 rounded-full text-xs font-bold border ${theme.accentSoft}`}>
        {match.collector_name} is going
      </span>
    ) : (
      <span className="px-2.5 py-1 rounded-full text-xs font-bold bg-amber-500/15 text-amber-600 dark:text-amber-400">
        Needs a volunteer
      </span>
    );

  return (
    <div className={`rounded-2xl border p-4 space-y-3.5 ${theme.card}`}>
      {/* Header */}
      <div className="flex items-start justify-between gap-2">
        <div>
          <div className="flex items-center gap-1.5 font-bold text-base">
            <Calendar className={`w-4 h-4 ${theme.accentText}`} />
            <span>{formatDateLabel(match.delivery_date)}</span>
          </div>
          <div className={`text-xs mt-0.5 ${theme.muted}`}>
            {match.membersList.length} students matched · {match.campus}
          </div>
        </div>
        {statusPill}
      </div>

      {/* Fair Suggestion */}
      {match.status === 'needs_volunteer' && match.suggested_collector && (
        <div className={`rounded-xl border px-3 py-2.5 text-xs font-semibold ${theme.accentSoft}`}>
          Fair suggestion: <strong>{match.suggested_collector.name}</strong> (
          {match.suggested_collector.completed_trips} completed{' '}
          {match.suggested_collector.completed_trips === 1 ? 'trip' : 'trips'})
        </div>
      )}

      {/* Volunteer Choice Buttons */}
      {match.status !== 'collected' && (
        <div className="grid grid-cols-2 gap-2">
          <button
            onClick={() => onVolunteer(match, 'will_collect')}
            disabled={Boolean(match.collector_user_id && !isCollector)}
            className={`min-h-[46px] px-3 rounded-xl text-xs font-bold transition disabled:opacity-45 ${
              me?.volunteer_choice === 'will_collect'
                ? theme.accentBg
                : `border ${theme.secondaryBtn}`
            }`}
          >
            I&apos;ll collect for everyone
          </button>
          <button
            onClick={() => onVolunteer(match, 'wont_collect')}
            className={`min-h-[46px] px-3 rounded-xl text-xs font-bold transition ${
              me?.volunteer_choice === 'wont_collect'
                ? 'bg-rose-600 text-white'
                : `border ${theme.secondaryBtn}`
            }`}
          >
            I won&apos;t collect
          </button>
        </div>
      )}

      {/* Phone Sharing Consent Checkbox (UNTICKED by default) */}
      <label className="flex items-center gap-2.5 min-h-[44px] cursor-pointer select-none">
        <input
          type="checkbox"
          checked={Boolean(me?.share_phone)}
          onChange={(e) => onToggleSharePhone(match.id, e.target.checked)}
          className="w-5 h-5 rounded accent-indigo-600"
        />
        <span className="text-sm font-medium">Share my number with this match</span>
      </label>

      {/* Collector Action: Enter Handover Spot & Mark Collected */}
      {isCollector && match.status === 'volunteer_assigned' && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            onMarkCollected(match, spotInput);
          }}
          className={`rounded-xl border p-3 space-y-2.5 ${theme.subCard}`}
        >
          <label className="block text-xs font-bold">
            Collected everyone&apos;s parcels? Enter handover spot:
          </label>
          <input
            type="text"
            value={spotInput}
            onChange={(e) => setSpotInput(e.target.value)}
            placeholder="e.g. Block A-2 Lobby at 6:30 PM"
            required
            className={`w-full min-h-[44px] px-3 rounded-xl border text-sm outline-none ${theme.input}`}
          />
          <button
            type="submit"
            className="w-full min-h-[46px] rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-sm flex items-center justify-center gap-2"
          >
            <CheckCircle2 className="w-4 h-4" /> Mark collected &amp; notify
          </button>
        </form>
      )}

      {/* Handover Spot Banner */}
      {match.status === 'collected' && (
        <div className="rounded-xl bg-emerald-500/15 border border-emerald-500/30 px-3.5 py-2.5 text-sm text-emerald-700 dark:text-emerald-300 flex items-start gap-2">
          <MapPin className="w-4 h-4 shrink-0 mt-0.5" />
          <div>
            <span className="text-xs font-semibold block opacity-80">Handover spot</span>
            <strong>{match.handover_spot}</strong>
          </div>
        </div>
      )}

      {/* Receiver's Private 4-Digit Handover Code */}
      {match.status === 'collected' && !isCollector && me?.my_handover_code && !me?.handed_over && (
        <div className={`rounded-xl border-2 border-dashed p-3.5 text-center ${theme.accentSoft}`}>
          <div className="text-xs font-semibold">
            Tell this 4-digit code to <strong>{match.collector_name}</strong> at pickup
          </div>
          <div className="text-3xl font-black tracking-[0.28em] mt-1">{me.my_handover_code}</div>
        </div>
      )}

      {/* Post-Handover Rating for Collector */}
      {match.status === 'collected' && !isCollector && me?.handed_over && (
        <div className={`rounded-xl border p-3 flex items-center justify-between gap-2 ${theme.subCard}`}>
          <div className="text-xs font-bold">
            Parcel handed over! Rate {match.collector_name}:
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => onRateCollector(match, 1)}
              className={`min-w-[44px] min-h-[40px] rounded-xl flex items-center justify-center transition ${
                match.my_rating === 1
                  ? 'bg-emerald-600 text-white'
                  : `border ${theme.secondaryBtn}`
              }`}
              aria-label="Thumbs up"
            >
              <ThumbsUp className="w-4 h-4" />
            </button>
            <button
              onClick={() => onRateCollector(match, -1)}
              className={`min-w-[44px] min-h-[40px] rounded-xl flex items-center justify-center transition ${
                match.my_rating === -1 ? 'bg-rose-600 text-white' : `border ${theme.secondaryBtn}`
              }`}
              aria-label="Thumbs down"
            >
              <ThumbsDown className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}

      {/* Match Members List */}
      <div className="space-y-2.5">
        {match.membersList.map((mem) => (
          <div key={mem.user_id} className={`rounded-xl border p-3 space-y-2 ${theme.subCard}`}>
            <div className="flex items-start justify-between gap-2">
              <div>
                <div className="font-bold text-sm">
                  {mem.name} {mem.is_me && <span className={theme.accentText}>(You)</span>}
                </div>
                <div className={`text-xs ${theme.muted}`}>
                  {mem.block_wing} · Room {mem.room_number}
                </div>
              </div>
              <div className="flex flex-wrap justify-end gap-1">
                {mem.is_verified && (
                  <span className={`px-2 py-0.5 rounded-full text-[11px] font-bold border ${theme.accentSoft}`}>
                    ✓ Verified
                  </span>
                )}
                {mem.is_trusted && (
                  <span className="px-2 py-0.5 rounded-full text-[11px] font-bold bg-emerald-500/15 text-emerald-600 dark:text-emerald-400">
                    ★ Trusted
                  </span>
                )}
              </div>
            </div>

            {/* Member's Parcels (Item Name & Order ID strictly hidden from others) */}
            <div className="space-y-1">
              {mem.parcels.map((p) => (
                <div key={p.id} className="text-xs space-y-0.5">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className="font-semibold">{p.courier}</span>
                    <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold border ${theme.card}`}>
                      {p.parcel_size}
                    </span>
                    {p.can_collect && p.free_from && p.free_until && (
                      <span className={theme.muted}>
                        · Free {p.free_from}–{p.free_until}
                      </span>
                    )}
                  </div>
                  {mem.is_me && (p.item_name || p.order_id) && (
                    <div className={`text-[11px] flex items-center gap-1 ${theme.muted}`}>
                      <Lock className="w-3 h-3" />
                      <span>
                        Private: {p.item_name || 'Item'}
                        {p.order_id ? ` (#${p.order_id})` : ''}
                      </span>
                    </div>
                  )}
                </div>
              ))}
            </div>

            {/* Shared Phone Number (only when member ticked consent) */}
            {mem.phone && (
              <a
                href={`tel:${mem.phone}`}
                className={`inline-flex items-center gap-1.5 text-xs font-semibold ${theme.accentText}`}
              >
                <Phone className="w-3.5 h-3.5" /> {mem.phone}
              </a>
            )}

            {/* Collector's 4-Digit Handover Verification Input */}
            {isCollector && match.status === 'collected' && !mem.is_me && (
              <div className="pt-1">
                {mem.handed_over ? (
                  <div className="inline-flex items-center gap-1 text-xs font-bold text-emerald-600 dark:text-emerald-400">
                    <CheckCircle2 className="w-4 h-4" /> Handed over
                  </div>
                ) : (
                  <form
                    onSubmit={async (e) => {
                      e.preventDefault();
                      const ok = await onConfirmHandover(
                        match,
                        mem.user_id,
                        codeInputs[mem.user_id] || ''
                      );
                      if (ok) {
                        setCodeInputs((prev) => ({ ...prev, [mem.user_id]: '' }));
                      }
                    }}
                    className="flex items-center gap-2"
                  >
                    <input
                      type="tel"
                      inputMode="numeric"
                      maxLength={4}
                      value={codeInputs[mem.user_id] || ''}
                      onChange={(e) =>
                        setCodeInputs((prev) => ({
                          ...prev,
                          [mem.user_id]: e.target.value.replace(/\D/g, ''),
                        }))
                      }
                      placeholder="4-digit code"
                      required
                      className={`w-32 min-h-[40px] px-3 rounded-xl border text-sm font-bold tracking-widest outline-none ${theme.input}`}
                    />
                    <button
                      type="submit"
                      className={`min-h-[40px] px-3.5 rounded-xl text-xs font-bold ${theme.accentBg}`}
                    >
                      Hand over
                    </button>
                  </form>
                )}
              </div>
            )}

            {/* Report / Block Buttons */}
            {!mem.is_me && (
              <div className="flex justify-end gap-2 pt-1">
                <button
                  onClick={() => onOpenReport(mem, match.id)}
                  className={`min-h-[34px] px-2.5 rounded-lg border text-xs font-semibold flex items-center gap-1 ${theme.secondaryBtn}`}
                >
                  <Flag className="w-3 h-3" /> Report
                </button>
                <button
                  onClick={() => onOpenBlock(mem)}
                  className="min-h-[34px] px-2.5 rounded-lg bg-rose-500/10 text-rose-600 dark:text-rose-400 border border-rose-500/30 text-xs font-semibold flex items-center gap-1"
                >
                  <Ban className="w-3 h-3" /> Block
                </button>
              </div>
            )}
          </div>
        ))}
      </div>

      {/* One-Tap WhatsApp / Email Notify Share */}
      <div className="flex items-center gap-2 pt-1">
        <button
          onClick={() => onShareUpdate(match, 'whatsapp')}
          className={`flex-1 min-h-[40px] px-3 rounded-xl border text-xs font-semibold flex items-center justify-center gap-1.5 ${theme.secondaryBtn}`}
        >
          <Share2 className="w-3.5 h-3.5 text-emerald-500" /> Notify via WhatsApp
        </button>
        <button
          onClick={() => onShareUpdate(match, 'email')}
          className={`flex-1 min-h-[40px] px-3 rounded-xl border text-xs font-semibold flex items-center justify-center gap-1.5 ${theme.secondaryBtn}`}
        >
          <Send className="w-3.5 h-3.5 text-indigo-500" /> Email update
        </button>
      </div>
    </div>
  );
}

// ============================================================================
// COMPONENT: ADD / EDIT PARCEL VIEW (WITH GEMINI VISION AI SCAN)
// ============================================================================
function AddParcelView({ theme, currentUser, editingParcel, showToast, onDone }) {
  const [deliveryDate, setDeliveryDate] = useState(
    editingParcel?.delivery_date || getTodayISO(0)
  );
  const [courier, setCourier] = useState(editingParcel?.courier || 'Amazon');
  const [parcelSize, setParcelSize] = useState(editingParcel?.parcel_size || 'Small');
  const [itemName, setItemName] = useState(editingParcel?.item_name || '');
  const [timeSlot, setTimeSlot] = useState(editingParcel?.time_slot || '');
  const [orderId, setOrderId] = useState(editingParcel?.order_id || '');
  const [canCollect, setCanCollect] = useState(Boolean(editingParcel?.can_collect));
  const [freeFrom, setFreeFrom] = useState(editingParcel?.free_from || '16:00');
  const [freeUntil, setFreeUntil] = useState(editingParcel?.free_until || '18:00');

  const [scanning, setScanning] = useState(false);
  const [aiMessage, setAiMessage] = useState('');
  const [formError, setFormError] = useState('');
  const [saving, setSaving] = useState(false);
  const fileInputRef = useRef(null);

  useEffect(() => {
    setDeliveryDate(editingParcel?.delivery_date || getTodayISO(0));
    setCourier(editingParcel?.courier || 'Amazon');
    setParcelSize(editingParcel?.parcel_size || 'Small');
    setItemName(editingParcel?.item_name || '');
    setTimeSlot(editingParcel?.time_slot || '');
    setOrderId(editingParcel?.order_id || '');
    setCanCollect(Boolean(editingParcel?.can_collect));
    setFreeFrom(editingParcel?.free_from || '16:00');
    setFreeUntil(editingParcel?.free_until || '18:00');
    setFormError('');
    setAiMessage('');
  }, [editingParcel]);

  const handleScreenshotUpload = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) {
      showToast('Please upload a JPG, PNG, or WebP screenshot.', 'error');
      e.target.value = '';
      return;
    }

    setScanning(true);
    setAiMessage('');

    try {
      // Read into memory ONLY, send to Gemini Vision, then discard immediately
      const base64Data = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => {
          const res = String(reader.result || '');
          const commaIdx = res.indexOf(',');
          resolve(commaIdx >= 0 ? res.slice(commaIdx + 1) : res);
        };
        reader.onerror = reject;
        reader.readAsDataURL(file);
      });

      const extracted = await extractParcelFromImage(base64Data, file.type);

      if (extracted) {
        if (extracted.delivery_date) setDeliveryDate(extracted.delivery_date);
        if (extracted.courier) setCourier(extracted.courier);
        if (extracted.parcel_size) setParcelSize(extracted.parcel_size);
        if (extracted.item_name) setItemName(extracted.item_name);
        if (extracted.time_slot) setTimeSlot(extracted.time_slot);
        if (extracted.order_id) setOrderId(extracted.order_id);
        setAiMessage('We filled in what we could read. Please check it.');
        showToast('Screenshot scanned and discarded from memory!', 'success');
      } else {
        setAiMessage('Could not read the screenshot automatically. Please fill in the form below.');
        showToast('Please fill in the parcel details manually.', 'info');
      }
    } catch {
      setAiMessage('Could not read the screenshot automatically. Please fill in the form below.');
    } finally {
      // Immediately clear file input so image is never retained
      if (fileInputRef.current) fileInputRef.current.value = '';
      setScanning(false);
    }
  };

  const handleSaveParcel = async (e) => {
    if (e && typeof e.preventDefault === 'function') e.preventDefault();
    if (saving) return;
    setFormError('');

    if (!currentUser || !currentUser.id) {
      const msg = 'Your session expired. Please sign in again.';
      setFormError(msg);
      showToast(msg, 'error');
      return;
    }

    const cleanDate = String(deliveryDate || '').trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(cleanDate)) {
      const msg = 'Please select a valid expected delivery date.';
      setFormError(msg);
      showToast(msg, 'error');
      return;
    }

    if (canCollect) {
      if (!freeFrom || !freeUntil) {
        const msg = 'Please choose both "Free from" and "Free until" times.';
        setFormError(msg);
        showToast(msg, 'error');
        return;
      }
      if (freeFrom >= freeUntil) {
        const msg = '"Free until" time must be later than "Free from" time.';
        setFormError(msg);
        showToast(msg, 'error');
        return;
      }
    }

    setSaving(true);
    try {
      const campusName = (currentUser.campus || DEFAULT_CAMPUS).trim() || DEFAULT_CAMPUS;
      const payload = {
        user_id: currentUser.id,
        campus: campusName,
        delivery_date: cleanDate,
        courier: VALID_COURIERS.includes(courier) ? courier : 'Other',
        parcel_size: VALID_SIZES.includes(parcelSize) ? parcelSize : 'Small',
        item_name: itemName.trim().slice(0, 160),
        time_slot: timeSlot.trim().slice(0, 80),
        order_id: orderId.trim().slice(0, 100),
        can_collect: Boolean(canCollect),
        free_from: canCollect ? freeFrom : null,
        free_until: canCollect ? freeUntil : null,
        updated_at: Date.now(),
      };

      if (editingParcel) {
        const oldDate = editingParcel.delivery_date;
        await updateDoc(publicDoc('parcels', editingParcel.id), payload);
        try {
          if (oldDate && oldDate !== cleanDate) {
            await syncMatchesForDate(editingParcel.campus || campusName, oldDate);
          }
          await syncMatchesForDate(campusName, cleanDate);
        } catch (syncErr) {
          console.error('Match sync warning:', syncErr);
        }
        showToast('Parcel updated! Matches recalculated.', 'success');
        onDone('mine');
      } else {
        await addDoc(publicCol('parcels'), {
          ...payload,
          match_group_id: null,
          created_at: Date.now(),
        });
        let newlyMatched = false;
        try {
          const res = await syncMatchesForDate(campusName, cleanDate);
          newlyMatched = Boolean(res?.newlyMatched);
        } catch (syncErr) {
          console.error('Match sync warning:', syncErr);
        }
        showToast(
          newlyMatched
            ? 'Parcel saved — You have a new campus parcel match!'
            : 'Parcel saved! We will match you as soon as a hostel mate adds the same date.',
          'success'
        );
        onDone('matches');
      }
    } catch (err) {
      console.error('Save parcel failed:', err);
      const errMsg = `Could not save parcel: ${err?.message || 'Please check your connection and try again.'}`;
      setFormError(errMsg);
      showToast(errMsg, 'error');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className={`rounded-2xl border p-4 space-y-4 ${theme.card}`}>
      <h2 className="text-lg font-extrabold">
        {editingParcel ? 'Edit parcel' : 'Add a parcel'}
      </h2>

      {/* Screenshot Upload for Gemini Vision AI */}
      {!editingParcel && (
        <label
          className={`block rounded-2xl border-2 border-dashed p-5 text-center cursor-pointer transition ${theme.accentSoft}`}
        >
          <input
            ref={fileInputRef}
            type="file"
            accept="image/png,image/jpeg,image/webp"
            onChange={handleScreenshotUpload}
            disabled={scanning}
            className="hidden"
          />
          <Camera className="w-7 h-7 mx-auto mb-1.5" />
          <div className="font-bold text-sm">
            {scanning ? 'Reading screenshot with AI...' : 'Upload order / tracking screenshot'}
          </div>
          <p className="text-xs opacity-80 mt-1">
            AI extracts date, courier &amp; size while ignoring personal details. Image is deleted
            immediately — never stored.
          </p>
        </label>
      )}

      {aiMessage && (
        <div className={`rounded-xl border px-3.5 py-2.5 text-xs font-semibold flex items-center gap-2 ${theme.accentSoft}`}>
          <Sparkles className="w-4 h-4 shrink-0" />
          <span>{aiMessage}</span>
        </div>
      )}

      {formError && (
        <div
          role="alert"
          className="rounded-xl border border-rose-500/40 bg-rose-500/15 px-3.5 py-2.5 text-xs font-semibold text-rose-600 dark:text-rose-300 flex items-center gap-2"
        >
          <AlertCircle className="w-4 h-4 shrink-0" />
          <span>{formError}</span>
        </div>
      )}

      <form onSubmit={handleSaveParcel} noValidate className="space-y-3">
        <div>
          <label className="block text-xs font-semibold mb-1">Expected delivery date</label>
          <input
            type="date"
            value={deliveryDate}
            onChange={(e) => {
              setDeliveryDate(e.target.value);
              if (formError) setFormError('');
            }}
            className={`w-full min-h-[46px] px-3.5 rounded-xl border text-sm outline-none ${theme.input}`}
          />
        </div>

        <div className="grid grid-cols-2 gap-2.5">
          <div>
            <label className="block text-xs font-semibold mb-1">Courier</label>
            <select
              value={courier}
              onChange={(e) => setCourier(e.target.value)}
              className={`w-full min-h-[46px] px-3 rounded-xl border text-sm outline-none ${theme.input}`}
            >
              {VALID_COURIERS.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-xs font-semibold mb-1">Parcel size</label>
            <select
              value={parcelSize}
              onChange={(e) => setParcelSize(e.target.value)}
              className={`w-full min-h-[46px] px-3 rounded-xl border text-sm outline-none ${theme.input}`}
            >
              {VALID_SIZES.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div>
          <label className="block text-xs font-semibold mb-1">
            Item name <span className={`font-normal ${theme.muted}`}>(optional · private to you)</span>
          </label>
          <input
            type="text"
            value={itemName}
            onChange={(e) => setItemName(e.target.value)}
            placeholder="e.g. Wireless mouse"
            className={`w-full min-h-[46px] px-3.5 rounded-xl border text-sm outline-none ${theme.input}`}
          />
        </div>

        <div className="grid grid-cols-2 gap-2.5">
          <div>
            <label className="block text-xs font-semibold mb-1">Time slot (optional)</label>
            <input
              type="text"
              value={timeSlot}
              onChange={(e) => setTimeSlot(e.target.value)}
              placeholder="e.g. 2 PM – 5 PM"
              className={`w-full min-h-[46px] px-3 rounded-xl border text-sm outline-none ${theme.input}`}
            />
          </div>
          <div>
            <label className="block text-xs font-semibold mb-1">Order ID (private)</label>
            <input
              type="text"
              value={orderId}
              onChange={(e) => setOrderId(e.target.value)}
              placeholder="e.g. OD12345"
              className={`w-full min-h-[46px] px-3 rounded-xl border text-sm outline-none ${theme.input}`}
            />
          </div>
        </div>

        <div>
          <label className="block text-xs font-semibold mb-1">Can you collect it?</label>
          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={() => {
                setCanCollect(true);
                if (formError) setFormError('');
              }}
              className={`min-h-[44px] rounded-xl font-semibold text-sm transition ${
                canCollect ? theme.accentBg : `border ${theme.secondaryBtn}`
              }`}
            >
              Yes, I can go
            </button>
            <button
              type="button"
              onClick={() => {
                setCanCollect(false);
                if (formError) setFormError('');
              }}
              className={`min-h-[44px] rounded-xl font-semibold text-sm transition ${
                !canCollect ? theme.accentBg : `border ${theme.secondaryBtn}`
              }`}
            >
              No
            </button>
          </div>
        </div>

        {canCollect && (
          <div className="grid grid-cols-2 gap-2.5">
            <div>
              <label className="block text-xs font-semibold mb-1">Free from</label>
              <input
                type="time"
                value={freeFrom}
                onChange={(e) => {
                  setFreeFrom(e.target.value);
                  if (formError) setFormError('');
                }}
                className={`w-full min-h-[46px] px-3 rounded-xl border text-sm outline-none ${theme.input}`}
              />
            </div>
            <div>
              <label className="block text-xs font-semibold mb-1">Free until</label>
              <input
                type="time"
                value={freeUntil}
                onChange={(e) => {
                  setFreeUntil(e.target.value);
                  if (formError) setFormError('');
                }}
                className={`w-full min-h-[46px] px-3 rounded-xl border text-sm outline-none ${theme.input}`}
              />
            </div>
          </div>
        )}

        <button
          type="button"
          onClick={handleSaveParcel}
          disabled={saving}
          className={`w-full min-h-[48px] rounded-xl font-bold text-sm shadow-sm disabled:opacity-60 ${theme.accentBg}`}
        >
          {saving
            ? 'Saving...'
            : editingParcel
            ? 'Save changes'
            : 'Confirm & Save Parcel'}
        </button>

        {editingParcel && (
          <button
            type="button"
            onClick={() => onDone('mine')}
            className={`w-full min-h-[44px] rounded-xl border font-semibold text-sm ${theme.secondaryBtn}`}
          >
            Cancel
          </button>
        )}
      </form>
    </div>
  );
}

// ============================================================================
// COMPONENT: MY PARCELS & FEEDBACK VIEW
// ============================================================================
function MyParcelsView({
  theme,
  currentUser,
  myParcels,
  deleteConfirmId,
  onEdit,
  onDelete,
  onOpenGuide,
  showToast,
}) {
  const [feedbackMsg, setFeedbackMsg] = useState('');
  const [sendingFeedback, setSendingFeedback] = useState(false);

  const handleFeedback = async (e) => {
    e.preventDefault();
    const clean = feedbackMsg.trim();
    if (clean.length < 4) return showToast('Write a short message first.', 'error');
    setSendingFeedback(true);
    try {
      await addDoc(publicCol('feedback'), {
        user_id: currentUser.id,
        user_name: currentUser.name,
        block_wing: currentUser.block_wing,
        message: clean.slice(0, 1000),
        created_at: Date.now(),
      });
      setFeedbackMsg('');
      showToast('Thanks! Your feedback was sent to the admin.', 'success');
    } catch {
      showToast('Could not send feedback.', 'error');
    } finally {
      setSendingFeedback(false);
    }
  };

  return (
    <div className="space-y-3.5">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-extrabold">My parcels</h2>
        <button
          onClick={onOpenGuide}
          className={`min-h-[38px] px-3 rounded-xl border text-xs font-semibold flex items-center gap-1.5 ${theme.secondaryBtn}`}
        >
          <HelpCircle className="w-4 h-4" /> How it works
        </button>
      </div>

      {myParcels.length === 0 ? (
        <div className={`rounded-2xl border p-6 text-center text-sm ${theme.card} ${theme.muted}`}>
          You haven&apos;t added any parcels yet.
        </div>
      ) : (
        myParcels.map((p) => {
          const isCollected = p.match_status === 'collected';
          const confirming = deleteConfirmId === p.id;
          return (
            <div key={p.id} className={`rounded-2xl border p-4 space-y-2 ${theme.card}`}>
              <div className="flex items-start justify-between gap-2">
                <div>
                  <div className="font-bold text-base">
                    {p.courier} · {p.parcel_size}
                  </div>
                  <div className={`text-xs ${theme.muted}`}>
                    {formatDateLabel(p.delivery_date)}
                  </div>
                </div>
                <span
                  className={`px-2.5 py-0.5 rounded-full text-xs font-bold ${
                    isCollected
                      ? 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400'
                      : `border ${theme.subCard} ${theme.muted}`
                  }`}
                >
                  {isCollected ? 'Collected' : 'Upcoming'}
                </span>
              </div>

              {p.item_name && (
                <div className="text-xs flex items-center gap-1.5">
                  <Lock className="w-3.5 h-3.5 text-indigo-500" />
                  <span>
                    Item: <strong>{p.item_name}</strong>
                  </span>
                </div>
              )}
              {p.order_id && (
                <div className={`text-xs ${theme.muted}`}>Order ID: {p.order_id}</div>
              )}
              {p.time_slot && (
                <div className={`text-xs ${theme.muted}`}>Delivery slot: {p.time_slot}</div>
              )}
              <div className={`text-xs ${theme.muted}`}>
                Can collect:{' '}
                <strong>
                  {p.can_collect ? `Yes (${p.free_from} – ${p.free_until})` : 'No'}
                </strong>
              </div>

              {!isCollected && (
                <div className="flex items-center gap-2 pt-1.5">
                  <button
                    onClick={() => onEdit(p)}
                    className={`min-h-[38px] px-3.5 rounded-xl border text-xs font-bold flex items-center gap-1.5 ${theme.secondaryBtn}`}
                  >
                    <Edit3 className="w-3.5 h-3.5" /> Edit
                  </button>
                  <button
                    onClick={() => onDelete(p)}
                    className={`min-h-[38px] px-3.5 rounded-xl text-xs font-bold flex items-center gap-1.5 transition ${
                      confirming
                        ? 'bg-rose-600 text-white'
                        : 'bg-rose-500/10 text-rose-600 dark:text-rose-400 border border-rose-500/30'
                    }`}
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                    {confirming ? 'Tap again to confirm' : 'Delete'}
                  </button>
                </div>
              )}
            </div>
          );
        })
      )}

      {/* Feedback Box */}
      <div className={`rounded-2xl border p-4 space-y-3 ${theme.card}`}>
        <h3 className="font-bold text-base">Send feedback to admin</h3>
        <form onSubmit={handleFeedback} className="space-y-2.5">
          <textarea
            value={feedbackMsg}
            onChange={(e) => setFeedbackMsg(e.target.value)}
            placeholder="Ideas, bugs, or updated parcel-room timings..."
            rows={3}
            required
            className={`w-full p-3 rounded-xl border text-sm outline-none resize-none ${theme.input}`}
          />
          <button
            type="submit"
            disabled={sendingFeedback}
            className={`w-full min-h-[44px] rounded-xl font-bold text-sm flex items-center justify-center gap-2 ${theme.accentBg}`}
          >
            <Send className="w-4 h-4" /> {sendingFeedback ? 'Sending...' : 'Send feedback'}
          </button>
        </form>
      </div>
    </div>
  );
}

// ============================================================================
// COMPONENT: PARCEL HEROES LEADERBOARD
// ============================================================================
function HeroesView({ theme, heroes, heroPeriod, setHeroPeriod, walkingStats }) {
  return (
    <div className="space-y-3.5">
      <div className="rounded-2xl bg-gradient-to-br from-indigo-600 to-indigo-700 text-white p-5 shadow-md space-y-2">
        <div className="flex items-center gap-2">
          <Trophy className="w-6 h-6 text-amber-300" />
          <h2 className="text-xl font-extrabold">Parcel Heroes</h2>
        </div>
        <p className="text-sm text-indigo-100">
          Students saving everyone the walk to the campus parcel collection area.
        </p>
        <div className="text-xs font-semibold pt-1 text-indigo-100">
          Total walking time saved:{' '}
          <strong className="text-white">{formatMinutes(walkingStats.campusMinutesSaved)}</strong> (
          {walkingStats.campusSavedTrips} trips saved)
        </div>
      </div>

      <div className={`rounded-2xl border p-4 space-y-3 ${theme.card}`}>
        <div className={`grid grid-cols-2 p-1 rounded-xl border ${theme.subCard}`}>
          <button
            onClick={() => setHeroPeriod('all_time')}
            className={`min-h-[40px] rounded-lg text-sm font-bold transition ${
              heroPeriod === 'all_time' ? 'bg-indigo-600 text-white shadow-sm' : theme.muted
            }`}
          >
            All time
          </button>
          <button
            onClick={() => setHeroPeriod('month')}
            className={`min-h-[40px] rounded-lg text-sm font-bold transition ${
              heroPeriod === 'month' ? 'bg-indigo-600 text-white shadow-sm' : theme.muted
            }`}
          >
            This month
          </button>
        </div>

        {heroes.length === 0 ? (
          <div className={`py-8 text-center text-sm ${theme.muted}`}>
            No completed trips yet. Volunteer for a match and complete a handover to claim #1!
          </div>
        ) : (
          <div className="space-y-2.5">
            {heroes.map((h, idx) => (
              <div key={h.id} className={`rounded-xl border p-3.5 space-y-2 ${theme.subCard}`}>
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-3">
                    <div
                      className={`w-8 h-8 rounded-full font-extrabold text-sm flex items-center justify-center ${
                        idx === 0
                          ? 'bg-amber-400 text-slate-900'
                          : idx === 1
                          ? 'bg-slate-300 text-slate-900'
                          : idx === 2
                          ? 'bg-amber-700 text-white'
                          : `${theme.card} border`
                      }`}
                    >
                      #{idx + 1}
                    </div>
                    <div>
                      <div className="font-bold text-sm">{h.name}</div>
                      <div className={`text-xs ${theme.muted}`}>
                        {h.block_wing} · {h.campus}
                      </div>
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="font-extrabold text-sm">
                      {h.trips} {h.trips === 1 ? 'trip' : 'trips'}
                    </div>
                    <div className={`text-xs ${theme.muted}`}>
                      {formatMinutes(h.minutesSaved)} saved
                    </div>
                  </div>
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {h.is_verified && (
                    <span className={`px-2 py-0.5 rounded-full text-[11px] font-bold border ${theme.accentSoft}`}>
                      ✓ Verified
                    </span>
                  )}
                  {h.is_trusted && (
                    <span className="px-2 py-0.5 rounded-full text-[11px] font-bold bg-emerald-500/15 text-emerald-600 dark:text-emerald-400">
                      ★ Trusted
                    </span>
                  )}
                  <span className={`px-2 py-0.5 rounded-full text-[11px] font-semibold border ${theme.card} ${theme.muted}`}>
                    Helped {h.helped} {h.helped === 1 ? 'student' : 'students'}
                  </span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ============================================================================
// COMPONENT: ADMIN PANEL (ADMIN ONLY)
// ============================================================================
function AdminView({
  theme,
  currentUser,
  settings,
  users,
  parcels,
  matches,
  reports,
  feedbackList,
  showToast,
  onSeedDemo,
  seedingDemo,
  onImpersonateDemo,
}) {
  const [inviteInput, setInviteInput] = useState(settings.invite_code || '');
  const [noticeInput, setNoticeInput] = useState(settings.parcel_notice || '');

  useEffect(() => {
    setInviteInput(settings.invite_code || '');
    setNoticeInput(settings.parcel_notice || '');
  }, [settings]);

  const tripsDone = useMemo(() => {
    return matches.filter((m) => {
      if (m.status !== 'collected' || !m.collector_user_id) return false;
      return Object.entries(m.members || {}).some(
        ([uid, info]) => uid !== m.collector_user_id && info?.handed_over_at
      );
    }).length;
  }, [matches]);

  const openReportsCount = reports.filter((r) => r.status === 'open').length;

  const saveInviteCode = async (e) => {
    e.preventDefault();
    try {
      const val = inviteInput.trim().slice(0, 40);
      await setDoc(publicDoc('settings', 'global'), { invite_code: val }, { merge: true });
      showToast(val ? `Invite code set to "${val}".` : 'Invite code removed (open sign-up).', 'success');
    } catch {
      showToast('Could not update invite code.', 'error');
    }
  };

  const saveNotice = async (e) => {
    e.preventDefault();
    try {
      await setDoc(
        publicDoc('settings', 'global'),
        { parcel_notice: noticeInput.trim().slice(0, 400) },
        { merge: true }
      );
      showToast('Parcel-room notice updated!', 'success');
    } catch {
      showToast('Could not update notice.', 'error');
    }
  };

  const toggleVerified = async (u) => {
    try {
      await updateDoc(publicDoc('users', u.id), { is_verified: !u.is_verified });
      showToast(
        !u.is_verified ? `Verified badge given to ${u.name}.` : `Verified badge removed from ${u.name}.`,
        'success'
      );
    } catch {
      showToast('Could not update badge.', 'error');
    }
  };

  const toggleReportStatus = async (r) => {
    const next = r.status === 'open' ? 'resolved' : 'open';
    try {
      await updateDoc(publicDoc('reports', r.id), { status: next });
      showToast(`Report marked ${next}.`, 'success');
    } catch {
      showToast('Could not update report.', 'error');
    }
  };

  const sortedUsers = [...users].sort((a, b) => (b.created_at || 0) - (a.created_at || 0));
  const sortedReports = [...reports].sort((a, b) => (b.created_at || 0) - (a.created_at || 0));
  const sortedFeedback = [...feedbackList].sort(
    (a, b) => (b.created_at || 0) - (a.created_at || 0)
  );

  return (
    <div className="space-y-3.5">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-extrabold flex items-center gap-2">
          <Shield className={`w-5 h-5 ${theme.accentText}`} /> Admin Panel
        </h2>
      </div>

      {/* KPI Grid */}
      <div className="grid grid-cols-2 gap-2.5">
        {[
          { label: 'Total users', value: users.length },
          { label: 'Total parcels', value: parcels.length },
          { label: 'Trips done', value: tripsDone },
          { label: 'Open / Total reports', value: `${openReportsCount} / ${reports.length}` },
        ].map((kpi) => (
          <div key={kpi.label} className={`rounded-2xl border p-3.5 text-center ${theme.card}`}>
            <div className={`text-2xl font-black ${theme.accentText}`}>{kpi.value}</div>
            <div className={`text-xs font-medium mt-0.5 ${theme.muted}`}>{kpi.label}</div>
          </div>
        ))}
      </div>

      {/* Solo Testing Helper */}
      <div className={`rounded-2xl border p-4 space-y-2.5 ${theme.card}`}>
        <div className="font-bold text-sm flex items-center gap-1.5">
          <UserPlus className={`w-4 h-4 ${theme.accentText}`} /> Quick Solo Testing Helper
        </div>
        <p className={`text-xs ${theme.muted}`}>
          Want to test group matching, 4-digit handover codes, and the Heroes leaderboard before
          sharing with friends? Add 2 demo hostel mates for Today &amp; Tomorrow.
        </p>
        <button
          onClick={onSeedDemo}
          disabled={seedingDemo}
          className={`w-full min-h-[44px] rounded-xl font-bold text-xs ${theme.accentBg}`}
        >
          {seedingDemo ? 'Adding demo hostel mates...' : 'Add demo hostel mates for testing'}
        </button>
      </div>

      {/* Invite Code Setting */}
      <div className={`rounded-2xl border p-4 space-y-2.5 ${theme.card}`}>
        <h3 className="font-bold text-sm">Optional Invite Code</h3>
        <p className={`text-xs ${theme.muted}`}>
          Leave empty for open sign-ups, or set a campus code to gate new registrations.
        </p>
        <form onSubmit={saveInviteCode} className="flex gap-2">
          <input
            type="text"
            value={inviteInput}
            onChange={(e) => setInviteInput(e.target.value)}
            placeholder="No invite code set"
            className={`flex-1 min-h-[44px] px-3 rounded-xl border text-sm outline-none ${theme.input}`}
          />
          <button type="submit" className={`min-h-[44px] px-4 rounded-xl font-bold text-sm ${theme.accentBg}`}>
            Save
          </button>
        </form>
      </div>

      {/* Parcel-room Notice Setting */}
      <div className={`rounded-2xl border p-4 space-y-2.5 ${theme.card}`}>
        <h3 className="font-bold text-sm">Parcel-Room Timings / Notice</h3>
        <form onSubmit={saveNotice} className="space-y-2">
          <textarea
            value={noticeInput}
            onChange={(e) => setNoticeInput(e.target.value)}
            rows={2}
            className={`w-full p-3 rounded-xl border text-sm outline-none resize-none ${theme.input}`}
          />
          <button type="submit" className={`min-h-[42px] px-4 rounded-xl font-bold text-xs ${theme.accentBg}`}>
            Update notice
          </button>
        </form>
      </div>

      {/* Users & Verified Badges */}
      <div className={`rounded-2xl border p-4 space-y-2.5 ${theme.card}`}>
        <h3 className="font-bold text-sm">Users &amp; Verified Badges</h3>
        <div className="space-y-2">
          {sortedUsers.map((u) => (
            <div
              key={u.id}
              className={`rounded-xl border p-3 flex items-center justify-between gap-2 ${theme.subCard}`}
            >
              <div className="min-w-0">
                <div className="font-bold text-sm truncate">
                  {u.name}{' '}
                  {u.is_demo && (
                    <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-500/20 text-amber-600 dark:text-amber-300">
                      Demo
                    </span>
                  )}
                </div>
                <div className={`text-xs truncate ${theme.muted}`}>
                  {u.block_wing}, Room {u.room_number} · {u.campus}
                </div>
              </div>
              <div className="flex items-center gap-1.5 shrink-0">
                {u.is_demo && (
                  <button
                    onClick={() => onImpersonateDemo(u.id)}
                    className={`min-h-[36px] px-2.5 rounded-lg border text-[11px] font-bold ${theme.secondaryBtn}`}
                  >
                    Test as
                  </button>
                )}
                <button
                  onClick={() => toggleVerified(u)}
                  className={`min-h-[36px] px-2.5 rounded-lg text-xs font-bold ${
                    u.is_verified ? theme.accentBg : `border ${theme.secondaryBtn}`
                  }`}
                >
                  {u.is_verified ? '✓ Verified' : 'Verify'}
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Reports */}
      <div className={`rounded-2xl border p-4 space-y-2.5 ${theme.card}`}>
        <h3 className="font-bold text-sm">Reports (Admin Only)</h3>
        {sortedReports.length === 0 ? (
          <p className={`text-xs ${theme.muted}`}>No reports submitted.</p>
        ) : (
          sortedReports.map((r) => (
            <div key={r.id} className={`rounded-xl border p-3 space-y-1.5 ${theme.subCard}`}>
              <div className="flex items-center justify-between gap-2">
                <strong className="text-sm">
                  {r.reported_name} ({r.reported_block})
                </strong>
                <span
                  className={`px-2 py-0.5 rounded-full text-[11px] font-bold ${
                    r.status === 'open'
                      ? 'bg-amber-500/15 text-amber-600 dark:text-amber-400'
                      : 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400'
                  }`}
                >
                  {r.status}
                </span>
              </div>
              <p className="text-xs">{r.reason}</p>
              <div className="flex items-center justify-between pt-1">
                <span className={`text-[11px] ${theme.muted}`}>
                  Reported by {r.reporter_name} ({r.reporter_block})
                </span>
                <button
                  onClick={() => toggleReportStatus(r)}
                  className={`min-h-[32px] px-2.5 rounded-lg border text-[11px] font-semibold ${theme.secondaryBtn}`}
                >
                  {r.status === 'open' ? 'Mark resolved' : 'Reopen'}
                </button>
              </div>
            </div>
          ))
        )}
      </div>

      {/* Student Feedback */}
      <div className={`rounded-2xl border p-4 space-y-2.5 ${theme.card}`}>
        <h3 className="font-bold text-sm">Student Feedback</h3>
        {sortedFeedback.length === 0 ? (
          <p className={`text-xs ${theme.muted}`}>No feedback messages yet.</p>
        ) : (
          sortedFeedback.map((f) => (
            <div key={f.id} className={`rounded-xl border p-3 space-y-1 ${theme.subCard}`}>
              <p className="text-xs">{f.message}</p>
              <div className={`text-[11px] ${theme.muted}`}>
                — {f.user_name || 'Student'} ({f.block_wing || '-'})
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

// ============================================================================
// COMPONENT: PROFILE MODAL (EDIT DETAILS + OPTIONAL COLLEGE EMAIL OTP)
// ============================================================================
function ProfileModal({ theme, user, stats, isTrusted, onClose, onSignOut, showToast }) {
  const [name, setName] = useState(user.name || '');
  const [blockWing, setBlockWing] = useState(user.block_wing || '');
  const [roomNumber, setRoomNumber] = useState(user.room_number || '');
  const [campus, setCampus] = useState(user.campus || DEFAULT_CAMPUS);
  const [email, setEmail] = useState(user.email || '');
  const [saving, setSaving] = useState(false);

  const [emailOtpSent, setEmailOtpSent] = useState('');
  const [emailOtpInput, setEmailOtpInput] = useState('');

  const handleSave = async (e) => {
    e.preventDefault();
    if (name.trim().length < 2) return showToast('Name is too short.', 'error');
    const cleanEmail = email.trim().toLowerCase();
    if (cleanEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEmail)) {
      return showToast('Enter a valid email address.', 'error');
    }

    setSaving(true);
    try {
      const emailChanged = cleanEmail !== (user.email || '');
      await updateDoc(publicDoc('users', user.id), {
        name: name.trim().slice(0, 100),
        block_wing: blockWing.trim().slice(0, 30),
        room_number: roomNumber.trim().slice(0, 20),
        campus: campus.trim().slice(0, 100) || DEFAULT_CAMPUS,
        email: cleanEmail,
        email_verified: emailChanged ? false : Boolean(user.email_verified),
        updated_at: Date.now(),
      });
      showToast('Profile details updated!', 'success');
    } catch {
      showToast('Could not update profile.', 'error');
    } finally {
      setSaving(false);
    }
  };

  const handleVerifyEmail = async (e) => {
    e.preventDefault();
    if (emailOtpInput.trim() !== emailOtpSent) {
      return showToast('Incorrect email verification code.', 'error');
    }
    try {
      await updateDoc(publicDoc('users', user.id), { email_verified: true });
      setEmailOtpSent('');
      setEmailOtpInput('');
      showToast('College email verified!', 'success');
    } catch {
      showToast('Could not verify email.', 'error');
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-bold">Your Profile</h3>
        <button
          onClick={onClose}
          className={`min-w-[40px] min-h-[40px] rounded-xl border flex items-center justify-center ${theme.secondaryBtn}`}
        >
          <X className="w-5 h-5" />
        </button>
      </div>

      <div className="flex flex-wrap gap-1.5">
        {user.is_verified && (
          <span className={`px-2.5 py-1 rounded-full text-xs font-bold border ${theme.accentSoft}`}>
            ✓ Verified
          </span>
        )}
        {isTrusted && (
          <span className="px-2.5 py-1 rounded-full text-xs font-bold bg-emerald-500/15 text-emerald-600 dark:text-emerald-400">
            ★ Trusted
          </span>
        )}
        <span className={`px-2.5 py-1 rounded-full text-xs font-semibold border ${theme.subCard} ${theme.muted}`}>
          {stats.completedTrips} completed {stats.completedTrips === 1 ? 'trip' : 'trips'}
        </span>
      </div>

      <form onSubmit={handleSave} className="space-y-3">
        <div>
          <label className="block text-xs font-semibold mb-1">Full name</label>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
            className={`w-full min-h-[44px] px-3 rounded-xl border text-sm outline-none ${theme.input}`}
          />
        </div>
        <div className="grid grid-cols-2 gap-2">
          <div>
            <label className="block text-xs font-semibold mb-1">Block &amp; wing</label>
            <input
              type="text"
              value={blockWing}
              onChange={(e) => setBlockWing(e.target.value)}
              required
              className={`w-full min-h-[44px] px-3 rounded-xl border text-sm outline-none ${theme.input}`}
            />
          </div>
          <div>
            <label className="block text-xs font-semibold mb-1">Room</label>
            <input
              type="text"
              value={roomNumber}
              onChange={(e) => setRoomNumber(e.target.value)}
              required
              className={`w-full min-h-[44px] px-3 rounded-xl border text-sm outline-none ${theme.input}`}
            />
          </div>
        </div>
        <div>
          <label className="block text-xs font-semibold mb-1">Campus</label>
          <input
            type="text"
            value={campus}
            onChange={(e) => setCampus(e.target.value)}
            required
            className={`w-full min-h-[44px] px-3 rounded-xl border text-sm outline-none ${theme.input}`}
          />
        </div>
        <div>
          <label className="block text-xs font-semibold mb-1">
            College email {user.email_verified ? '(✓ Verified)' : '(optional)'}
          </label>
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="name@vitbhopal.ac.in"
            className={`w-full min-h-[44px] px-3 rounded-xl border text-sm outline-none ${theme.input}`}
          />
        </div>
        <button
          type="submit"
          disabled={saving}
          className={`w-full min-h-[46px] rounded-xl font-bold text-sm ${theme.accentBg}`}
        >
          {saving ? 'Saving...' : 'Save profile'}
        </button>
      </form>

      {/* Optional College Email Verification */}
      {user.email && !user.email_verified && (
        <div className={`rounded-xl border p-3 space-y-2.5 ${theme.subCard}`}>
          <div className="text-xs font-bold">Verify college email ({user.email})</div>
          {!emailOtpSent ? (
            <button
              type="button"
              onClick={() => setEmailOtpSent(generateOTP(6))}
              className={`min-h-[40px] px-3.5 rounded-xl border text-xs font-bold ${theme.secondaryBtn}`}
            >
              Generate email verification code
            </button>
          ) : (
            <form onSubmit={handleVerifyEmail} className="space-y-2">
              <div className={`text-xs font-semibold px-2.5 py-1.5 rounded-lg border ${theme.accentSoft}`}>
                Test Email Code: <strong>{emailOtpSent}</strong>
              </div>
              <div className="flex gap-2">
                <input
                  type="tel"
                  maxLength={6}
                  value={emailOtpInput}
                  onChange={(e) => setEmailOtpInput(e.target.value.replace(/\D/g, ''))}
                  placeholder="6-digit code"
                  required
                  className={`flex-1 min-h-[40px] px-3 rounded-xl border text-sm outline-none ${theme.input}`}
                />
                <button type="submit" className={`min-h-[40px] px-3.5 rounded-xl text-xs font-bold ${theme.accentBg}`}>
                  Verify
                </button>
              </div>
            </form>
          )}
        </div>
      )}

      <button
        onClick={onSignOut}
        className="w-full min-h-[44px] rounded-xl bg-rose-500/10 text-rose-600 dark:text-rose-400 border border-rose-500/30 font-bold text-sm flex items-center justify-center gap-2"
      >
        <LogOut className="w-4 h-4" /> Sign out
      </button>
    </div>
  );
}

// ============================================================================
// COMPONENT: REPORT MODAL
// ============================================================================
function ReportModal({ theme, targetUser, matchId, onSubmit, onClose }) {
  const [reason, setReason] = useState('');
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-bold">Report {targetUser.name}</h3>
        <button
          onClick={onClose}
          className={`min-w-[40px] min-h-[40px] rounded-xl border flex items-center justify-center ${theme.secondaryBtn}`}
        >
          <X className="w-5 h-5" />
        </button>
      </div>
      <p className={`text-xs flex items-start gap-1.5 ${theme.muted}`}>
        <AlertCircle className="w-4 h-4 shrink-0 mt-0.5 text-amber-500" />
        <span>Reports are confidential and visible only to the campus admin.</span>
      </p>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          onSubmit({ id: targetUser.user_id, name: targetUser.name, block_wing: targetUser.block_wing }, matchId, reason);
        }}
        className="space-y-3"
      >
        <textarea
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder="Tell the admin what happened..."
          rows={3}
          required
          className={`w-full p-3 rounded-xl border text-sm outline-none resize-none ${theme.input}`}
        />
        <button
          type="submit"
          className="w-full min-h-[46px] rounded-xl bg-rose-600 hover:bg-rose-700 text-white font-bold text-sm"
        >
          Submit report
        </button>
        <button
          type="button"
          onClick={onClose}
          className={`w-full min-h-[44px] rounded-xl border font-semibold text-sm ${theme.secondaryBtn}`}
        >
          Cancel
        </button>
      </form>
    </div>
  );
}