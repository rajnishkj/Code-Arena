import React, { useState, useEffect, useRef } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { ArrowRight, X } from 'lucide-react';
import Hls from 'hls.js';
import { gsap } from 'gsap';
import API from '../services/api';
import NavBar from '../components/NavBar';
import createWebSocketClient from '../services/websocket';

const HLS_STREAM_URL =
    'https://stream.mux.com/tLkHO1qZoaaQOUeVWo8hEBeGQfySP02EPS02BmnNFyXys.m3u8';

// Matches the backend queue TTL (TTL_MS in services/matchmaking.py).
const SEARCH_SECONDS = 60;

const STYLES = `
@import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;600;700;800&family=Instrument+Serif:ital@0;1&display=swap');

.lobby-glass-card {
  position: relative;
  background: rgba(255,255,255,0.01);
  background-blend-mode: luminosity;
  backdrop-filter: blur(4px);
  -webkit-backdrop-filter: blur(4px);
  box-shadow: inset 0 1px 1px rgba(255,255,255,0.10);
  border-radius: 20px;
}
.lobby-glass-card::before {
  content: '';
  position: absolute;
  inset: 0;
  padding: 1.4px;
  border-radius: 20px;
  background: linear-gradient(180deg, rgba(255,255,255,0.22) 0%, rgba(255,255,255,0.04) 100%);
  -webkit-mask: linear-gradient(#fff 0 0) content-box, linear-gradient(#fff 0 0);
  -webkit-mask-composite: xor;
  mask-composite: exclude;
  pointer-events: none;
}

.lobby-panel {
  flex: 1;
  background: rgba(255,255,255,0.02);
  border: 1px solid rgba(255,255,255,0.06);
  border-radius: 16px;
  padding: 24px 20px;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 10px;
  transition: border-color 0.3s, box-shadow 0.3s;
}

.lobby-panel.searching {
  border-color: rgba(94,210,156,0.3);
  box-shadow: 0 0 24px rgba(94,210,156,0.08);
}

.lobby-panel.opponent-idle {
  border-color: rgba(255,255,255,0.04);
}

.lobby-avatar {
  width: 56px;
  height: 56px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  font-family: 'Inter', sans-serif;
  font-size: 22px;
  font-weight: 700;
  color: #070b0a;
  background: #5ed29c;
}

.lobby-avatar.opponent {
  background: rgba(255,255,255,0.06);
  color: rgba(255,255,255,0.3);
  font-size: 26px;
}

.lobby-vs {
  font-family: 'Instrument Serif', serif;
  font-style: italic;
  font-size: 28px;
  font-weight: 700;
  color: rgba(94,210,156,0.5);
  text-shadow: 0 0 20px rgba(94,210,156,0.2);
  flex-shrink: 0;
  width: 48px;
  text-align: center;
}

.lobby-btn-main {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  padding: 14px 36px;
  border-radius: 12px;
  border: none;
  background: #5ed29c;
  color: #070b0a;
  font-family: 'Inter', sans-serif;
  font-size: 14px;
  font-weight: 800;
  letter-spacing: 0.10em;
  cursor: pointer;
  transition: background 0.2s, transform 0.15s, box-shadow 0.2s;
  box-shadow: 0 0 28px rgba(94,210,156,0.25);
}
.lobby-btn-main:hover:not(:disabled) { background: #79e8b4; transform: translateY(-2px); box-shadow: 0 0 40px rgba(94,210,156,0.4); }
.lobby-btn-main:disabled { opacity: 0.35; cursor: not-allowed; transform: none; box-shadow: none; }

.lobby-btn-cancel {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 10px 20px;
  border-radius: 10px;
  border: 1px solid rgba(255,255,255,0.10);
  background: transparent;
  color: rgba(255,255,255,0.4);
  font-family: 'Inter', sans-serif;
  font-size: 12px;
  font-weight: 600;
  letter-spacing: 0.06em;
  cursor: pointer;
  transition: border-color 0.2s, color 0.2s;
}
.lobby-btn-cancel:hover { border-color: rgba(255,107,107,0.4); color: #ff6b6b; }

.lobby-info-row {
  display: flex;
  align-items: center;
  gap: 24px;
  justify-content: center;
  font-family: 'Inter', sans-serif;
  font-size: 11px;
  color: rgba(255,255,255,0.2);
  letter-spacing: 0.04em;
}

@media (max-width: 640px) {
  .lobby-panels { flex-direction: column !important; }
  .lobby-vs { transform: rotate(90deg); width: auto; }
}
`;

function injectStyles() {
    if (document.getElementById('lobby-styles')) return;
    const el = document.createElement('style');
    el.id = 'lobby-styles';
    el.textContent = STYLES;
    document.head.appendChild(el);
}

export default function Lobby() {
    const navigate = useNavigate();
    const videoRef = useRef(null);
    const cardRef = useRef(null);
    const oppRef = useRef(null);
    const statusRef = useRef(null);
    const pollRef = useRef(null);

    const userId = localStorage.getItem('userId');
    const storedUsername = localStorage.getItem('username');

    const [user, setUser] = useState(null);
    const [status, setStatus] = useState('');
    const [searching, setSearching] = useState(false);
    const [joinErr, setJoinErr] = useState('');
    const [deadline, setDeadline] = useState(null);
    const [secondsLeft, setSecondsLeft] = useState(SEARCH_SECONDS);

    // Search countdown. The backend drops queue entries after SEARCH_SECONDS,
    // so searching past it would wait on a queue that no longer holds us.
    useEffect(() => {
        if (!searching || !deadline) return;
        const tick = () => {
            const left = Math.max(0, Math.ceil((deadline - Date.now()) / 1000));
            setSecondsLeft(left);
            if (left > 0) return;
            if (pollRef.current) clearInterval(pollRef.current);
            API.post('/matchmaking/leave').catch(() => {});
            setSearching(false);
            setStatus('');
            setJoinErr('No opponent found. Try again.');
        };
        tick();
        const id = setInterval(tick, 250);
        return () => clearInterval(id);
    }, [searching, deadline]);

    // Styles
    useEffect(() => { injectStyles(); }, []);

    // HLS video
    useEffect(() => {
        const video = videoRef.current;
        if (!video) return;
        if (Hls.isSupported()) {
            const hls = new Hls({ enableWorker: false });
            hls.loadSource(HLS_STREAM_URL);
            hls.attachMedia(video);
            hls.on(Hls.Events.MANIFEST_PARSED, () => video.play().catch(() => { }));
            return () => hls.destroy();
        } else if (video.canPlayType('application/vnd.apple.mpegurl')) {
            video.src = HLS_STREAM_URL;
            video.play().catch(() => { });
        }
    }, []);

    // Fetch user data
    useEffect(() => {
        if (!userId) return;
        API.get('/users/me').then(res => setUser(res.data)).catch(() => {});
    }, [userId]);

    // Card entrance
    useEffect(() => {
        if (cardRef.current) {
            gsap.fromTo(cardRef.current,
                { opacity: 0, y: 40 },
                { opacity: 1, y: 0, duration: 0.8, ease: 'power3.out' }
            );
        }
    }, [userId]);

    // WebSocket — listen for match found
    useEffect(() => {
        if (!userId) return;
        const client = createWebSocketClient({
            onMatchUpdate: (match) => {
                if (match && match.id) {
                    if (pollRef.current) clearInterval(pollRef.current);
                    setSearching(false);
                    navigate('/match', {
                        state: {
                            matchId: match.id,
                            userId,
                            problemId: match.problemId
                        }
                    });
                }
            },
            userId,
            onError: (err) => console.warn('WS fallback to polling:', err)
        });
        return () => client.deactivate();
    }, [userId, navigate]);

    // Character trail
    useEffect(() => {
        const CHARS = '{}[]()<>/;:=*&#@!?01+-~|^%$';
        let last = 0;
        const onTrail = (e) => {
            const now = Date.now();
            if (now - last < 40) return;
            last = now;
            const el = document.createElement('span');
            el.textContent = CHARS[Math.floor(Math.random() * CHARS.length)];
            const ox = (Math.random() - 0.5) * 24;
            Object.assign(el.style, {
                position: 'fixed',
                left: `${e.clientX + ox}px`,
                top: `${e.clientY}px`,
                color: '#5ed29c',
                fontFamily: 'monospace',
                fontSize: `${Math.floor(Math.random() * 8) + 11}px`,
                fontWeight: '700',
                pointerEvents: 'none',
                userSelect: 'none',
                zIndex: 9999,
                opacity: 1,
                transform: 'translateX(-50%)',
            });
            document.body.appendChild(el);
            gsap.to(el, {
                y: 55 + Math.random() * 30,
                opacity: 0,
                duration: 0.7 + Math.random() * 0.4,
                ease: 'power1.out',
                onComplete: () => el.remove(),
            });
        };
        window.addEventListener('mousemove', onTrail);
        return () => window.removeEventListener('mousemove', onTrail);
    }, []);

    // Opponent panel pulse when searching
    useEffect(() => {
        if (searching && oppRef.current) {
            gsap.to(oppRef.current, {
                borderColor: 'rgba(94,210,156,0.5)',
                boxShadow: '0 0 32px rgba(94,210,156,0.15)',
                duration: 1.2,
                repeat: -1,
                yoyo: true,
                ease: 'sine.inOut',
            });
        } else if (oppRef.current) {
            gsap.killTweensOf(oppRef.current);
            oppRef.current.style.borderColor = 'rgba(255,255,255,0.04)';
            oppRef.current.style.boxShadow = 'none';
        }
    }, [searching]);

    // Status pulse
    useEffect(() => {
        if (searching && statusRef.current) {
            gsap.to(statusRef.current, {
                opacity: 0.3, repeat: -1, yoyo: true, duration: 0.8
            });
        } else if (statusRef.current) {
            gsap.killTweensOf(statusRef.current);
            gsap.to(statusRef.current, { opacity: 1 });
        }
    }, [searching]);

    const joinQueue = async () => {
        setDeadline(Date.now() + SEARCH_SECONDS * 1000);
        setSecondsLeft(SEARCH_SECONDS);
        setSearching(true);
        setStatus('Scanning for opponents...');
        setJoinErr('');
        try {
            await API.post('/matchmaking/join');
        } catch (err) {
            setSearching(false);
            setStatus('');
            setJoinErr(err.response?.data?.error || 'Failed to join queue — try again');
            return;
        }

        pollRef.current = setInterval(async () => {
            try {
                const res = await API.get('/matchmaking/status');
                if (res.data && res.data.id) {
                    clearInterval(pollRef.current);
                    setSearching(false);
                    navigate('/match', {
                        state: {
                            matchId: res.data.id,
                            userId,
                            problemId: res.data.problemId
                        }
                    });
                }
            } catch {}
        }, 3000);
    };

    const leaveQueue = async () => {
        if (pollRef.current) clearInterval(pollRef.current);
        try { await API.post('/matchmaking/leave'); } catch {}
        setSearching(false);
        setStatus('');
        setJoinErr('');
    };

    // ── Not logged in ──
    if (!userId) {
        return (
            <div style={{ position: 'relative', minHeight: '100vh', overflow: 'hidden', background: '#070b0a' }}>
                <video ref={videoRef} muted loop playsInline style={{
                    position: 'absolute', inset: 0, width: '100%', height: '100%',
                    objectFit: 'cover', opacity: 0.6, zIndex: 0,
                }} />
                <div style={{ position: 'absolute', inset: 0, zIndex: 1, background: 'linear-gradient(to right, #070b0a 0%, transparent 55%)' }} />
                <div style={{ position: 'absolute', inset: 0, zIndex: 1, background: 'linear-gradient(to top, #070b0a 0%, transparent 50%)' }} />
                <svg style={{ position: 'absolute', top: 0, left: '50%', transform: 'translateX(-50%)', width: '900px', height: '320px', zIndex: 2, pointerEvents: 'none', overflow: 'visible' }} aria-hidden="true">
                    <defs><filter id="lobby-login-glow"><feGaussianBlur stdDeviation="25" result="blur" /></filter></defs>
                    <ellipse cx="450" cy="60" rx="420" ry="80" fill="rgba(0,200,130,0.18)" filter="url(#lobby-login-glow)" />
                </svg>
                <NavBar />
                <div style={{ position: 'relative', zIndex: 10, minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '24px' }}>
                    <div className="lobby-glass-card" style={{ width: '100%', maxWidth: 340, padding: '36px 32px', display: 'flex', flexDirection: 'column', gap: 14, textAlign: 'center', alignItems: 'center' }}>
                        <span style={{ fontSize: 13, fontWeight: 700, letterSpacing: '0.12em', color: 'rgba(255,255,255,0.5)' }}>[ JOIN THE ARENA ]</span>
                        <p style={{ fontSize: 20, fontWeight: 700, color: '#fff', margin: 0, lineHeight: 1.25 }}>
                            Enter the{' '}
                            <em style={{ fontFamily: 'Instrument Serif, serif', fontStyle: 'italic', color: '#5ed29c' }}>Arena</em>
                        </p>
                        <p style={{ fontSize: 11, color: 'rgba(255,255,255,0.4)', margin: 0, lineHeight: 1.6 }}>
                            Login or create an account to start battling.
                        </p>
                        <Link to="/login" style={{
                            display: 'inline-flex', alignItems: 'center', gap: 8, marginTop: 8,
                            padding: '12px 28px', borderRadius: 10, border: 'none',
                            background: '#5ed29c', color: '#070b0a',
                            fontFamily: 'Inter, sans-serif', fontSize: 13, fontWeight: 800,
                            letterSpacing: '0.10em', textDecoration: 'none',
                            boxShadow: '0 0 24px rgba(94,210,156,0.3)',
                            transition: 'background 0.2s, transform 0.15s',
                        }}
                            onMouseEnter={e => { e.target.style.background = '#79e8b4'; e.target.style.transform = 'translateY(-1px)'; }}
                            onMouseLeave={e => { e.target.style.background = '#5ed29c'; e.target.style.transform = 'translateY(0)'; }}
                        >
                            Login
                            <ArrowRight size={15} strokeWidth={2.5} />
                        </Link>
                    </div>
                </div>
            </div>
        );
    }

    // ── Logged in ──
    const displayName = user?.username || storedUsername || 'Player';
    const initial = displayName.charAt(0).toUpperCase();
    const elo = user?.elo ?? '—';

    return (
        <div style={{ position: 'relative', minHeight: '100vh', overflow: 'hidden', background: '#070b0a' }}>

            <video ref={videoRef} muted loop playsInline style={{
                position: 'absolute', inset: 0, width: '100%', height: '100%',
                objectFit: 'cover', opacity: 0.6, zIndex: 0,
            }} />

            <div style={{ position: 'absolute', inset: 0, zIndex: 1, background: 'linear-gradient(to right, #070b0a 0%, transparent 55%)' }} />
            <div style={{ position: 'absolute', inset: 0, zIndex: 1, background: 'linear-gradient(to top, #070b0a 0%, transparent 50%)' }} />

            <div style={{ position: 'absolute', inset: 0, zIndex: 2, pointerEvents: 'none' }}>
                {[25, 50, 75].map(pct => (
                    <div key={pct} style={{ position: 'absolute', left: `${pct}%`, top: 0, bottom: 0, width: '1px', background: 'rgba(255,255,255,0.07)' }} />
                ))}
            </div>

            <svg style={{ position: 'absolute', top: 0, left: '50%', transform: 'translateX(-50%)', width: '900px', height: '320px', zIndex: 2, pointerEvents: 'none', overflow: 'visible' }} aria-hidden="true">
                <defs><filter id="lobby-glow"><feGaussianBlur stdDeviation="25" result="blur" /></filter></defs>
                <ellipse cx="450" cy="60" rx="420" ry="80" fill="rgba(0,200,130,0.18)" filter="url(#lobby-glow)" />
            </svg>

            <NavBar />

            <div style={{ position: 'relative', zIndex: 10, minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '24px' }}>
                <div ref={cardRef} className="lobby-glass-card" style={{ width: '100%', maxWidth: 640, padding: '36px 32px', display: 'flex', flexDirection: 'column', gap: 24 }}>

                    <span style={{ fontSize: 13, fontWeight: 700, letterSpacing: '0.12em', color: 'rgba(255,255,255,0.5)' }}>[ READY ROOM ]</span>

                    {/* ── VS Panels ── */}
                    <div className="lobby-panels" style={{ display: 'flex', gap: 12, alignItems: 'center' }}>

                        {/* Player */}
                        <div className="lobby-panel" style={{ borderColor: searching ? 'rgba(94,210,156,0.2)' : 'rgba(255,255,255,0.06)' }}>
                            <div className="lobby-avatar">{initial}</div>
                            <span style={{ fontFamily: 'Inter, sans-serif', fontSize: 15, fontWeight: 700, color: '#fff' }}>{displayName}</span>
                            <span style={{ fontFamily: 'Inter, sans-serif', fontSize: 13, fontWeight: 600, color: '#5ed29c' }}>{elo} ELO</span>

                        </div>

                        {/* VS */}
                        <div className="lobby-vs">VS</div>

                        {/* Opponent */}
                        <div ref={oppRef} className={`lobby-panel ${searching ? 'searching' : 'opponent-idle'}`}>
                            <div className="lobby-avatar opponent" style={searching ? { color: '#5ed29c', fontVariantNumeric: 'tabular-nums' } : undefined}>
                                {searching ? secondsLeft : '?'}
                            </div>
                            <span style={{ fontFamily: 'Inter, sans-serif', fontSize: 15, fontWeight: 700, color: searching ? 'rgba(94,210,156,0.7)' : 'rgba(255,255,255,0.2)' }}>
                                {searching ? 'Searching' : 'Opponent'}
                            </span>
                            <span style={{ fontFamily: 'Inter, sans-serif', fontSize: 11, color: searching ? 'rgba(94,210,156,0.4)' : 'rgba(255,255,255,0.12)', textAlign: 'center' }}>
                                {searching ? 'Scanning the arena...' : 'Waiting for challenger'}
                            </span>
                        </div>
                    </div>

                    {/* ── Actions ── */}
                    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12 }}>
                        <button className="lobby-btn-main" onClick={joinQueue} disabled={searching}>
                            {searching ? 'Searching...' : 'Find Match'}
                            {!searching && <ArrowRight size={16} strokeWidth={2.5} />}
                        </button>
                        {searching && (
                            <button className="lobby-btn-cancel" onClick={leaveQueue}>
                                <X size={14} strokeWidth={2} />
                                Cancel
                            </button>
                        )}
                    </div>

                    {/* ── Status ── */}
                    {status && (
                        <p ref={statusRef} style={{
                            fontFamily: 'Inter, sans-serif', fontSize: 12, color: '#5ed29c',
                            textAlign: 'center', margin: 0,
                        }}>{status}</p>
                    )}
                    {joinErr && (
                        <p style={{
                            fontFamily: 'Inter, sans-serif', fontSize: 12, color: '#ff6b6b',
                            textAlign: 'center', margin: 0,
                        }}>{joinErr}</p>
                    )}

                    {/* ── Info ── */}
                    <div className="lobby-info-row">
                        {user ? (
                            <span>Elo range: {Math.max(0, user.elo - 100)}–{user.elo + 100}</span>
                        ) : (
                            <span>Elo range: —</span>
                        )}
                        <span>•</span>
                        <span>Avg wait: ~0.5s</span>
                    </div>

                </div>
            </div>
        </div>
    );
}
