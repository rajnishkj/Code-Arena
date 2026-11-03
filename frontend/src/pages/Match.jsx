import React, { useState, useEffect, useRef } from 'react';
import { useLocation, useNavigate, Navigate } from 'react-router-dom';
import Editor from '@monaco-editor/react';
import Hls from 'hls.js';
import { gsap } from 'gsap';
import createWebSocketClient from '../services/websocket';
import API from '../services/api';
import NavBar from '../components/NavBar';

const HLS_STREAM_URL =
    'https://stream.mux.com/tLkHO1qZoaaQOUeVWo8hEBeGQfySP02EPS02BmnNFyXys.m3u8';

const STYLES = `
@import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;600;700;800&family=Instrument+Serif:ital@0;1&display=swap');

.mc-glass {
  position: relative;
  background: rgba(255,255,255,0.01);
  background-blend-mode: luminosity;
  backdrop-filter: blur(4px);
  -webkit-backdrop-filter: blur(4px);
  box-shadow: inset 0 1px 1px rgba(255,255,255,0.10);
  border-radius: 16px;
}
.mc-glass::before {
  content: '';
  position: absolute;
  inset: 0;
  padding: 1.4px;
  border-radius: 16px;
  background: linear-gradient(180deg, rgba(255,255,255,0.22) 0%, rgba(255,255,255,0.04) 100%);
  -webkit-mask: linear-gradient(#fff 0 0) content-box, linear-gradient(#fff 0 0);
  -webkit-mask-composite: xor;
  mask-composite: exclude;
  pointer-events: none;
}

.mc-btn-green {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  background: #5ed29c;
  color: #070b0a;
  font-family: 'Inter', sans-serif;
  font-size: 12px;
  font-weight: 800;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  padding: 10px 20px;
  border-radius: 9999px;
  border: none;
  cursor: pointer;
  transition: background 0.2s, transform 0.15s, box-shadow 0.2s;
  box-shadow: 0 0 16px rgba(94,210,156,0.25);
}
.mc-btn-green:hover:not(:disabled) { background: #79e8b4; transform: translateY(-1px); box-shadow: 0 0 28px rgba(94,210,156,0.4); }
.mc-btn-green:disabled { opacity: 0.35; cursor: not-allowed; box-shadow: none; }

.mc-btn-blue {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  background: transparent;
  color: #569cd6;
  font-family: 'Inter', sans-serif;
  font-size: 12px;
  font-weight: 700;
  letter-spacing: 0.06em;
  padding: 10px 16px;
  border-radius: 9999px;
  border: 1px solid rgba(86,156,214,0.4);
  cursor: pointer;
  transition: background 0.2s, border-color 0.2s;
}
.mc-btn-blue:hover { background: rgba(86,156,214,0.1); border-color: #569cd6; }

.mc-btn-red {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  background: transparent;
  color: #ff6b6b;
  font-family: 'Inter', sans-serif;
  font-size: 12px;
  font-weight: 700;
  letter-spacing: 0.06em;
  padding: 10px 16px;
  border-radius: 9999px;
  border: 1px solid rgba(255,107,107,0.3);
  cursor: pointer;
  transition: background 0.2s, border-color 0.2s;
}
.mc-btn-red:hover { background: rgba(255,107,107,0.1); border-color: #ff6b6b; }

.mc-tab {
  font-family: 'Inter', sans-serif;
  font-size: 12px;
  font-weight: 600;
  letter-spacing: 0.06em;
  padding: 8px 16px;
  border: none;
  cursor: pointer;
  transition: color 0.2s, background 0.2s;
}

@keyframes fadeIn {
  from { opacity: 0; transform: translateY(8px); }
  to   { opacity: 1; transform: translateY(0); }
}
`;

function injectStyles() {
    if (document.getElementById('mc-styles')) return;
    const el = document.createElement('style');
    el.id = 'mc-styles';
    el.textContent = STYLES;
    document.head.appendChild(el);
}

const LANGUAGES = [
    { id: 'python', label: 'Python', version: '3.12.0', monaco: 'python' },
    { id: 'javascript', label: 'JavaScript', version: '18.15.0', monaco: 'javascript' },
    { id: 'java', label: 'Java', version: '15.0.2', monaco: 'java' },
    { id: 'c++', label: 'C++', version: '10.2.0', monaco: 'cpp' },
    { id: 'go', label: 'Go', version: '1.16.2', monaco: 'go' },
    { id: 'rust', label: 'Rust', version: '1.68.2', monaco: 'rust' },
];

const Match = () => {
    const location = useLocation();
    const navigate = useNavigate();
    const { matchId, userId, problemId } = location.state || {};

    const videoRef = useRef(null);
    const cardRef = useRef(null);

    const [problem, setProblem] = useState(null);
    const [matchDetails, setMatchDetails] = useState(null);
    const [code, setCode] = useState('');
    const [result, setResult] = useState(null);
    const [activeTab, setActiveTab] = useState('testcases');
    const [matchOver, setMatchOver] = useState(false);
    const [matchWon, setMatchWon] = useState(null);
    const [opponentAlive, setOpponentAlive] = useState(true);
    const [eloChange, setEloChange] = useState(null);
    const [connectionLost, setConnectionLost] = useState(false);
    const [toasts, setToasts] = useState([]);
    const [language, setLanguage] = useState(LANGUAGES[0]);
    const [running, setRunning] = useState(false);
    const [submitting, setSubmitting] = useState(false);
    const [problemError, setProblemError] = useState(false);

    const addToast = (message, type = 'error') => {
        const id = Date.now();
        setToasts(prev => [...prev, { id, message, type }]);
        setTimeout(() => setToasts(prev => prev.filter(t => t.id !== id)), 4000);
    };

    const isNetworkError = (err) => !err.response || err.response.status >= 502;

    const forfeitSent = useRef(false);
    const lostOpponent = useRef(false);
    const [endReason, setEndReason] = useState('');

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

    // Card entrance
    useEffect(() => {
        if (cardRef.current) {
            gsap.fromTo(cardRef.current,
                { opacity: 0, y: 30 },
                { opacity: 1, y: 0, duration: 0.7, ease: 'power3.out' }
            );
        }
    }, []);

    const opponentUsername = matchDetails
        ? (String(userId) === String(matchDetails.p1Id) ? matchDetails.p2Username : matchDetails.p1Username)
        : '...';

    const opponentId = matchDetails
        ? (String(userId) === String(matchDetails.p1Id) ? matchDetails.p2Id : matchDetails.p1Id)
        : null;

    const extractEloChange = (match, uid) =>
        String(match.p1) === String(uid) ? match.p1EloChange : match.p2EloChange;

    useEffect(() => {
        API.get(`/problems/${problemId}`).then(res => setProblem(res.data)).catch(() => { setProblemError(true); addToast('Failed to load problem'); });
        API.get(`/matches/${matchId}`).then(res => setMatchDetails(res.data)).catch(() => addToast('Failed to load match details'));

        const client = createWebSocketClient({
            onMatchUpdate: () => setConnectionLost(false),
            onMatchResult: (msg) => {
                setEloChange(extractEloChange(msg, userId));
                const won = String(msg.winner) === String(userId);
                setMatchWon(won);
                setMatchOver(true);
                setEndReason(r => r || (won ? 'opponent_forfeit' : 'opponent_complete'));
            },
            onError: () => setConnectionLost(true),
            userId,
        });

        return () => {
            client.deactivate();
        };
    }, [problemId, matchId, userId]);

    useEffect(() => {
        if (!matchId || !userId || matchOver) return;
        const onLeave = () => {
            if (forfeitSent.current) return;
            forfeitSent.current = true;
        };
        window.addEventListener('beforeunload', onLeave);
        return () => window.removeEventListener('beforeunload', onLeave);
    }, [matchId, userId, matchOver]);

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

    // Heartbeat — ping server every 2s
    useEffect(() => {
        if (!matchId || !userId || matchOver) return;
        const id = setInterval(() => {
            API.post('/matches/heartbeat', null, { params: { matchId } }).catch(() => addToast('Heartbeat failed — connection may be unstable'));
        }, 2000);
        return () => clearInterval(id);
    }, [matchId, userId, matchOver]);

    // Opponent alive check — poll every 2s, auto-forfeit after ~4s dark
    useEffect(() => {
        if (!matchId || !userId || !opponentId || matchOver) return;
        const id = setInterval(async () => {
            try {
                const res = await API.get('/matches/heartbeat/status', {
                    params: { matchId, opponentId }
                });
                const alive = res.data.opponentAlive;
                setOpponentAlive(alive);
                if (!alive) {
                    if (lostOpponent.current) {
                        if (forfeitSent.current) return;
                        forfeitSent.current = true;
                        setEndReason('disconnect_win');
                        await API.post('/matches/complete', null, { params: { matchId } });
                        endMatch(true);
                    } else {
                        lostOpponent.current = true;
                    }
                } else {
                    lostOpponent.current = false;
                }
            } catch { addToast('Failed to check opponent status'); }
        }, 2000);
        return () => clearInterval(id);
    }, [matchId, userId, opponentId, matchOver]);

    const doForfeit = async () => {
        if (forfeitSent.current || matchOver) return;
        forfeitSent.current = true;
        setEndReason('forfeit');
        try {
            await API.post('/matches/forfeit', null, { params: { matchId } });
            endMatch(false);
        } catch {
            forfeitSent.current = false;
            setEndReason('');
            addToast('Forfeit request failed — try again');
        }
    };

    const handleRun = async () => {
        if (matchOver || running || submitting) return;
        const samples = problem?.testCases?.filter(tc => tc.sample) || [];
        if (samples.length === 0) return;

        setRunning(true);
        try {
            const caseResults = await Promise.all(
                samples.map(async (tc) => {
                    const judgeRes = await API.post(
                        `/judge/execute?language=${encodeURIComponent(language.id)}&version=${encodeURIComponent(language.version)}&stdin=${encodeURIComponent(tc.input)}`,
                        code,
                        { headers: { 'Content-Type': 'text/plain' } }
                    );
                    const actualOutput = String(judgeRes.data).trim();
                    return { passed: actualOutput === tc.expectedOutput.trim(), actualOutput };
                })
            );

            const passed = caseResults.filter(r => r.passed).length;
            const results = caseResults.map(r => r.passed);
            const outputs = caseResults.map(r => r.actualOutput);
            setResult({ passed, total: results.length, results, outputs, isRun: true });
            setActiveTab('output');
        } catch (err) {
            setResult({ error: isNetworkError(err) ? 'Judge service unavailable — try again' : err.message, isRun: true });
            setActiveTab('output');
        }
        setRunning(false);
    };

    const endMatch = (won) => {
        setMatchWon(won);
        setMatchOver(true);
        forfeitSent.current = true;
    };

    const [leftWidth, setLeftWidth] = useState(45);
    const [isDragging, setIsDragging] = useState(false);

    const handleMouseDown = () => setIsDragging(true);

    useEffect(() => {
        const handleMouseMove = (e) => {
            if (!isDragging) return;
            const percent = (e.clientX / window.innerWidth) * 100;
            if (percent > 20 && percent < 80) setLeftWidth(percent);
        };
        const handleMouseUp = () => setIsDragging(false);

        window.addEventListener('mousemove', handleMouseMove);
        window.addEventListener('mouseup', handleMouseUp);
        return () => {
            window.removeEventListener('mousemove', handleMouseMove);
            window.removeEventListener('mouseup', handleMouseUp);
        };
    }, [isDragging]);

    const [editorHeight, setEditorHeight] = useState(60);
    const [isDraggingVertical, setIsDraggingVertical] = useState(false);
    const [isMobile, setIsMobile] = useState(window.innerWidth < 768);

    useEffect(() => {
        const mq = window.matchMedia('(max-width: 767px)');
        const handler = (e) => setIsMobile(e.matches);
        mq.addEventListener('change', handler);
        return () => mq.removeEventListener('change', handler);
    }, []);

    useEffect(() => {
        const handleMouseMove = (e) => {
            if (isDraggingVertical) {
                const rightPanel = document.getElementById('right-panel');
                const rect = rightPanel.getBoundingClientRect();
                const percent = ((e.clientY - rect.top) / rect.height) * 100;
                if (percent > 20 && percent < 85) setEditorHeight(percent);
            }
        };
        const handleMouseUp = () => setIsDraggingVertical(false);

        window.addEventListener('mousemove', handleMouseMove);
        window.addEventListener('mouseup', handleMouseUp);
        return () => {
            window.removeEventListener('mousemove', handleMouseMove);
            window.removeEventListener('mouseup', handleMouseUp);
        };
    }, [isDraggingVertical]);

    const handleSubmit = async () => {
        if (matchOver || submitting || running) return;
        const allTestCases = problem?.testCases || [];

        setSubmitting(true);
        try {
            const caseResults = await Promise.all(
                allTestCases.map(async (tc) => {
                    const judgeRes = await API.post(
                        `/judge/execute?language=${encodeURIComponent(language.id)}&version=${encodeURIComponent(language.version)}&stdin=${encodeURIComponent(tc.input)}`,
                        code,
                        { headers: { 'Content-Type': 'text/plain' } }
                    );
                    const actualOutput = String(judgeRes.data).trim();
                    return { passed: actualOutput === tc.expectedOutput.trim(), actualOutput };
                })
            );

            const passed = caseResults.filter(r => r.passed).length;
            const total = caseResults.length;
            const results = caseResults.map(r => r.passed);
            const outputs = caseResults.map(r => r.actualOutput);
            setResult({ passed, total, results, outputs, isRun: false });
            setActiveTab('output');

            if (passed === total) {
                setEndReason(r => r || 'submit');
                const res = await API.post('/matches/complete', null, {
                    params: { matchId }
                });
                setEloChange(extractEloChange(res.data, userId));
                endMatch(true);
            }
        } catch (err) {
            if (err.response?.status === 409) {
                setEndReason('opponent_faster');
                endMatch(false);
                return;
            }
            setResult({ error: isNetworkError(err) ? 'Judge service unavailable — try again' : err.message });
            setActiveTab('output');
        }
        setSubmitting(false);
    };

    const sampleTestCases = problem?.testCases?.filter(tc => tc.sample) || [];

    if (!matchId || !userId) return <Navigate to="/lobby" replace />;

    const getMatchOverTitle = () => {
        switch (endReason) {
            case 'submit': return 'Victory!';
            case 'forfeit': return 'You forfeited';
            case 'disconnect_win': return 'You Win';
            case 'opponent_forfeit': return 'Opponent forfeited';
            case 'opponent_complete': return 'You Lose';
            case 'opponent_faster': return 'Opponent was faster';
            default: return matchWon ? 'You Win' : 'You Lose';
        }
    };

    const getMatchOverSubtitle = () => {
        switch (endReason) {
            case 'submit': return 'All test cases passed';
            case 'disconnect_win': return 'Opponent disconnected';
            case 'opponent_forfeit': return '';
            case 'opponent_complete': return 'Opponent solved the problem';
            case 'opponent_faster': return 'Opponent completed all test cases first';
            default: return '';
        }
    };

    return (
        <div style={{ position: 'relative', height: '100vh', overflow: 'hidden', background: '#070b0a' }}>

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
                <defs><filter id="match-glow"><feGaussianBlur stdDeviation="25" result="blur" /></filter></defs>
                <ellipse cx="450" cy="60" rx="420" ry="80" fill="rgba(0,200,130,0.18)" filter="url(#match-glow)" />
            </svg>

            <NavBar />

            {connectionLost && (
                <div style={{
                    position: 'fixed', top: 76, left: 0, right: 0, zIndex: 9999,
                    background: 'rgba(255,68,68,0.9)', backdropFilter: 'blur(8px)',
                    textAlign: 'center', padding: '8px 16px',
                    fontFamily: "'Inter', sans-serif", fontSize: 13, fontWeight: 600, color: '#fff',
                }}>
                    ⚠ Connection lost — retrying...
                </div>
            )}

            {/* ── MATCH OVER OVERLAY ── */}
            {matchOver && (
                <div style={{
                    position: 'absolute', inset: 0, zIndex: 9998,
                    background: 'rgba(7,11,10,0.85)',
                    backdropFilter: 'blur(8px)',
                    display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
                }}>
                    <div className="mc-glass" style={{ padding: '48px 56px', textAlign: 'center' }}>
                        <span style={{
                            fontFamily: "'Instrument Serif', serif",
                            fontSize: 56, fontWeight: 700,
                            fontStyle: 'italic',
                            color: matchWon ? '#5ed29c' : '#ff6b6b',
                        }}>
                            {getMatchOverTitle()}
                        </span>
                        {getMatchOverSubtitle() && (
                            <p style={{ margin: '8px 0 0', fontFamily: "'Inter', sans-serif", fontSize: 14, color: 'rgba(255,255,255,0.5)' }}>
                                {getMatchOverSubtitle()}
                            </p>
                        )}
                        {result && !result.isRun && (
                            <p style={{ margin: '16px 0 0', fontFamily: "'Inter', sans-serif", fontSize: 14, color: 'rgba(255,255,255,0.5)' }}>
                                {result.passed} / {result.total} Test Cases Passed
                            </p>
                        )}
                        {eloChange !== null && (
                            <p style={{ marginTop: 8, fontFamily: "'Inter', sans-serif", fontSize: 22, fontWeight: 800, color: eloChange >= 0 ? '#5ed29c' : '#ff6b6b' }}>
                                {eloChange >= 0 ? `+${eloChange}` : eloChange} Elo
                            </p>
                        )}
                        <div style={{ marginTop: 28 }}>
                            <button
                                onClick={() => navigate('/lobby')}
                                className="mc-btn-green"
                                style={{ fontSize: 13, padding: '12px 32px' }}
                            >
                                Back to Lobby
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* ── DEBUG BAR ── */}
            {matchDetails && (
                <div style={{
                    position: 'fixed', bottom: 8, left: 8, zIndex: 9999,
                    fontSize: 10, color: 'rgba(255,255,255,0.12)', fontFamily: 'monospace',
                }}>
                    Match #{matchDetails.matchId} | P1: {matchDetails.p1Username} ({matchDetails.p1Id}) | P2: {matchDetails.p2Username} ({matchDetails.p2Id})
                </div>
            )}

            {/* ── MAIN LAYOUT ── */}
            <div ref={cardRef} style={{ position: 'relative', zIndex: 10, height: '100vh', paddingTop: 76 }}>
                <div style={{ display: 'flex', flexDirection: isMobile ? 'column' : 'row', height: 'calc(100vh - 76px)', padding: '12px' }}>

                    {/* ── LEFT PANEL (Problem) ── */}
                    <div className="mc-glass" style={{ width: isMobile ? '100%' : `${leftWidth}%`, maxHeight: isMobile ? '35vh' : 'none', overflowY: 'auto', padding: '20px', marginRight: isMobile ? 0 : '10px', marginBottom: isMobile ? 10 : 0 }}>
                        {problem ? (
                            <>
                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
                                    <h2 style={{ fontFamily: "'Inter', sans-serif", fontSize: 18, fontWeight: 700, color: '#fff', margin: 0 }}>{problem.title}</h2>
                                    <span style={{
                                        padding: '2px 10px',
                                        borderRadius: 9999,
                                        fontSize: 11,
                                        fontFamily: "'Inter', sans-serif",
                                        fontWeight: 700,
                                        letterSpacing: '0.06em',
                                        background: problem.difficulty === 'EASY' ? 'rgba(78,201,78,0.15)' : problem.difficulty === 'MEDIUM' ? 'rgba(255,165,0,0.15)' : 'rgba(255,68,68,0.15)',
                                        color: problem.difficulty === 'EASY' ? '#4ec94e' : problem.difficulty === 'MEDIUM' ? '#ffa500' : '#ff4444'
                                    }}>
                                        {problem.difficulty}
                                    </span>
                                </div>

                                <p style={{ fontFamily: "'Inter', sans-serif", fontSize: 13, lineHeight: '1.7', color: 'rgba(255,255,255,0.7)', margin: '0 0 16px' }}>{problem.description}</p>

                                <h4 style={{ fontFamily: "'Inter', sans-serif", fontSize: 12, fontWeight: 700, color: '#569cd6', textTransform: 'uppercase', letterSpacing: '0.08em', margin: '0 0 6px' }}>Input Format</h4>
                                <p style={{ fontFamily: "'Inter', sans-serif", fontSize: 13, color: 'rgba(255,255,255,0.6)', margin: '0 0 16px' }}>{problem.inputFormat}</p>

                                <h4 style={{ fontFamily: "'Inter', sans-serif", fontSize: 12, fontWeight: 700, color: '#569cd6', textTransform: 'uppercase', letterSpacing: '0.08em', margin: '0 0 6px' }}>Output Format</h4>
                                <p style={{ fontFamily: "'Inter', sans-serif", fontSize: 13, color: 'rgba(255,255,255,0.6)', margin: '0 0 16px' }}>{problem.outputFormat}</p>

                                <h4 style={{ fontFamily: "'Inter', sans-serif", fontSize: 12, fontWeight: 700, color: '#569cd6', textTransform: 'uppercase', letterSpacing: '0.08em', margin: '0 0 6px' }}>Constraints</h4>
                                <pre style={{ fontFamily: 'monospace', fontSize: 12, background: 'rgba(0,0,0,0.3)', padding: '12px', borderRadius: 8, color: 'rgba(255,255,255,0.7)', margin: '0 0 16px' }}>{problem.constraints}</pre>

                                <h4 style={{ fontFamily: "'Inter', sans-serif", fontSize: 12, fontWeight: 700, color: '#569cd6', textTransform: 'uppercase', letterSpacing: '0.08em', margin: '0 0 12px' }}>Examples</h4>
                                {sampleTestCases.map((tc, i) => (
                                    <div key={i} style={{ background: 'rgba(0,0,0,0.2)', padding: '12px', borderRadius: 8, marginBottom: 10 }}>
                                        <p style={{ fontFamily: "'Inter', sans-serif", fontSize: 11, fontWeight: 600, color: 'rgba(255,255,255,0.3)', textTransform: 'uppercase', letterSpacing: '0.06em', margin: '0 0 6px' }}>Example {i + 1}</p>
                                        <p style={{ margin: '0 0 4px', fontFamily: 'monospace', fontSize: 12, color: 'rgba(255,255,255,0.7)' }}><span style={{ color: '#569cd6' }}>Input:</span> {tc.input}</p>
                                        <p style={{ margin: 0, fontFamily: 'monospace', fontSize: 12, color: 'rgba(255,255,255,0.7)' }}><span style={{ color: '#569cd6' }}>Output:</span> {tc.expectedOutput}</p>
                                    </div>
                                ))}
                            </>
                        ) : problemError ? (
                            <p style={{ fontFamily: "'Inter', sans-serif", fontSize: 13, color: '#ff6b6b' }}>Failed to load problem</p>
                        ) : (
                            <p style={{ fontFamily: "'Inter', sans-serif", fontSize: 13, color: 'rgba(255,255,255,0.3)' }}>Loading problem...</p>
                        )}
                    </div>

                    {/* ── DIVIDER ── */}
                    {!isMobile && (
                    <div
                        onMouseDown={handleMouseDown}
                        style={{ width: '4px', cursor: 'col-resize', background: isDragging ? 'rgba(94,210,156,0.3)' : 'rgba(255,255,255,0.06)', borderRadius: 2, flexShrink: 0, transition: 'background 0.2s' }}
                    />
                    )}

                    {/* ── RIGHT PANEL ── */}
                    <div id="right-panel" style={{ flex: 1, display: 'flex', flexDirection: 'column', marginLeft: isMobile ? 0 : '10px', overflow: 'hidden' }}>

                        {/* ── TOP BAR ── */}
                        <div className="mc-glass" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 16px', flexShrink: 0 }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
                                <span style={{ fontFamily: "'Inter', sans-serif", fontSize: 13, color: 'rgba(255,255,255,0.3)' }}>
                                    vs <span style={{ color: '#5ed29c', fontWeight: 700 }}>{opponentUsername}</span>
                                </span>
                                {!matchOver && !opponentAlive && (
                                    <span style={{ fontFamily: "'Inter', sans-serif", fontSize: 11, fontWeight: 600, color: '#ff6b6b' }}>
                                        ⚠ opponent disconnected
                                    </span>
                                )}
                            </div>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                                <select
                                    value={language.id}
                                    onChange={e => {
                                        const lang = LANGUAGES.find(l => l.id === e.target.value);
                                        if (lang) setLanguage(lang);
                                    }}
                                    style={{
                                        background: 'rgba(255,255,255,0.04)', color: 'rgba(255,255,255,0.6)',
                                        border: '1px solid rgba(255,255,255,0.1)', borderRadius: 9999,
                                        padding: '8px 12px', fontSize: 11, fontFamily: "'Inter', sans-serif",
                                        fontWeight: 600, cursor: 'pointer', outline: 'none',
                                    }}
                                >
                                    {LANGUAGES.map(l => (
                                        <option key={l.id} value={l.id} style={{ background: '#1a1a1a', color: '#fff' }}>
                                            {l.label} ({l.version})
                                        </option>
                                    ))}
                                </select>
                                {!matchOver && (
                                    <button onClick={handleRun} className="mc-btn-blue" disabled={running || submitting || connectionLost}>{running ? 'Running...' : 'Run'}</button>
                                )}
                                {!matchOver && (
                                    <button onClick={() => { if (window.confirm('Forfeit match?')) doForfeit(); }} className="mc-btn-red">Forfeit</button>
                                )}
                                <button
                                    onClick={handleSubmit}
                                    disabled={matchOver || connectionLost || running || submitting}
                                    className="mc-btn-green"
                                >
                                    {matchOver ? 'Finished' : submitting ? 'Submitting...' : connectionLost ? 'Reconnecting…' : 'Submit'}
                                </button>
                            </div>
                        </div>

                        {/* ── EDITOR ── */}
                        <div style={{ flex: 1, overflow: 'hidden', marginTop: 10, borderRadius: 12 }}>
                            <Editor
                                height="100%"
                                language={language.monaco}
                                value={code}
                                onChange={(value) => setCode(value)}
                                theme="vs-dark"
                                options={{
                                    fontSize: 14,
                                    minimap: { enabled: false },
                                    scrollBeyondLastLine: false,
                                    readOnly: matchOver,
                                }}
                            />
                        </div>

                        {/* ── VERTICAL DIVIDER ── */}
                        <div
                            onMouseDown={() => setIsDraggingVertical(true)}
                            style={{
                                height: '4px', cursor: 'row-resize', marginTop: 10,
                                background: isDraggingVertical ? 'rgba(94,210,156,0.3)' : 'rgba(255,255,255,0.06)',
                                borderRadius: 2, flexShrink: 0, transition: 'background 0.2s',
                            }}
                        />

                        {/* ── BOTTOM PANEL (Test Cases / Output) ── */}
                        <div className="mc-glass" style={{ flex: 1, display: 'flex', flexDirection: 'column', marginTop: 10, overflow: 'hidden', minHeight: 0 }}>
                            <div style={{ display: 'flex', borderBottom: '1px solid rgba(255,255,255,0.06)', flexShrink: 0 }}>
                                <button
                                    onClick={() => setActiveTab('testcases')}
                                    className="mc-tab"
                                    style={{ color: activeTab === 'testcases' ? '#fff' : 'rgba(255,255,255,0.3)', background: activeTab === 'testcases' ? 'rgba(255,255,255,0.03)' : 'transparent' }}
                                >
                                    Test Cases
                                </button>
                                <button
                                    onClick={() => setActiveTab('output')}
                                    className="mc-tab"
                                    style={{ color: activeTab === 'output' ? '#fff' : 'rgba(255,255,255,0.3)', background: activeTab === 'output' ? 'rgba(255,255,255,0.03)' : 'transparent' }}
                                >
                                    Output
                                </button>
                            </div>

                            <div style={{ padding: '12px', overflowY: 'auto', flex: 1, fontFamily: "'Inter', sans-serif", fontSize: 13 }}>
                                {activeTab === 'testcases' && (
                                    sampleTestCases.map((tc, i) => (
                                        <div key={i} style={{ marginBottom: 10 }}>
                                            <p style={{ margin: '0 0 4px', fontFamily: "'Inter', sans-serif", fontSize: 11, fontWeight: 600, color: 'rgba(255,255,255,0.3)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>Case {i + 1}</p>
                                            <p style={{ margin: '0 0 2px', fontFamily: 'monospace', fontSize: 12, color: 'rgba(255,255,255,0.6)' }}><span style={{ color: '#569cd6' }}>Input:</span> <code>{tc.input}</code></p>
                                            <p style={{ margin: 0, fontFamily: 'monospace', fontSize: 12, color: 'rgba(255,255,255,0.6)' }}><span style={{ color: '#569cd6' }}>Expected:</span> <code>{tc.expectedOutput}</code></p>
                                        </div>
                                    ))
                                )}

                                {activeTab === 'output' && (
                                    result?.error ? (
                                        <pre style={{ color: '#ff6b6b', margin: 0, fontFamily: 'monospace', fontSize: 12 }}>{result.error}</pre>
                                    ) : result ? (
                                        <div>
                                            <p style={{ display: 'flex', alignItems: 'center', gap: 8, color: result.passed === result.total ? '#5ed29c' : '#ffa500', fontWeight: 700, margin: '0 0 12px', fontSize: 13 }}>
                                                {result.isRun && <span style={{ fontSize: 10, color: '#569cd6', background: 'rgba(86,156,214,0.15)', padding: '2px 8px', borderRadius: 4, letterSpacing: '0.06em' }}>SAMPLE</span>}
                                                {result.passed} / {result.total} Test Cases Passed
                                            </p>
                                            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                                                {result.results.map((passed, i) => (
                                                    <div key={i} style={{
                                                        padding: '6px 12px',
                                                        borderRadius: 9999,
                                                        background: passed ? 'rgba(78,201,78,0.12)' : 'rgba(255,68,68,0.12)',
                                                        color: passed ? '#4ec94e' : '#ff4444',
                                                        fontSize: 12,
                                                        fontWeight: 700,
                                                        fontFamily: "'Inter', sans-serif",
                                                        display: 'inline-block',
                                                        alignSelf: 'flex-start',
                                                    }}>
                                                        {passed ? '✅' : '❌'} {result.isRun ? 'Sample' : 'Case'} {i + 1}
                                                    </div>
                                                ))}
                                                {result.outputs?.some(o => o) && !result.results.every(Boolean) && (
                                                    <pre style={{
                                                        margin: '4px 0 0',
                                                        fontFamily: 'monospace',
                                                        fontSize: 11,
                                                        color: '#ff6b6b',
                                                        background: 'rgba(255,68,68,0.06)',
                                                        padding: '8px 12px',
                                                        borderRadius: 6,
                                                        whiteSpace: 'pre-wrap',
                                                        wordBreak: 'break-all',
                                                    }}>
                                                        {result.outputs[result.results.indexOf(false)]}
                                                    </pre>
                                                )}
                                            </div>
                                        </div>
                                    ) : (
                                        <p style={{ color: 'rgba(255,255,255,0.25)', fontSize: 12 }}>No output yet.</p>
                                    )
                                )}
                            </div>
                        </div>
                    </div>
                </div>
            </div>
            {toasts.map(t => (
                <div key={t.id} style={{
                    position: 'fixed', bottom: 48, right: 16, zIndex: 99999,
                    background: t.type === 'error' ? 'rgba(255,68,68,0.92)' : 'rgba(94,210,156,0.92)',
                    backdropFilter: 'blur(8px)',
                    padding: '10px 18px', borderRadius: 8,
                    fontFamily: "'Inter', sans-serif", fontSize: 13, fontWeight: 600, color: '#fff',
                    animation: 'fadeIn 0.2s ease',
                }}>
                    {t.message}
                </div>
            ))}
        </div>
    );
}

export default Match;
