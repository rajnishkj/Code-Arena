import React, { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { gsap } from 'gsap';
import API from '../services/api';

const STYLES = `
@import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;600;700;800&display=swap');

.acct-dropdown {
  position: absolute;
  top: calc(100% + 8px);
  right: 0;
  min-width: 220px;
  background: rgba(12,16,15,0.95);
  backdrop-filter: blur(12px);
  -webkit-backdrop-filter: blur(12px);
  border: 1px solid rgba(255,255,255,0.10);
  border-radius: 12px;
  padding: 12px;
  z-index: 300;
  box-shadow: 0 12px 40px rgba(0,0,0,0.5);
}

.acct-item {
  display: block;
  width: 100%;
  padding: 10px 12px;
  border: none;
  border-radius: 8px;
  background: none;
  color: rgba(255,255,255,0.85);
  font-family: 'Inter', sans-serif;
  font-size: 13px;
  font-weight: 600;
  letter-spacing: 0.04em;
  text-align: left;
  cursor: pointer;
  transition: background 0.15s, color 0.15s;
  box-sizing: border-box;
}
.acct-item:hover { background: rgba(94,210,156,0.10); color: #5ed29c; }

.acct-divider { height: 1px; background: rgba(255,255,255,0.06); margin: 6px 0; }

.acct-input {
  width: 100%;
  background: rgba(255,255,255,0.04);
  border: 1px solid rgba(255,255,255,0.08);
  border-radius: 6px;
  padding: 8px 10px;
  color: #fff;
  font-family: 'Inter', sans-serif;
  font-size: 12px;
  outline: none;
  box-sizing: border-box;
  transition: border-color 0.2s;
}
.acct-input:focus { border-color: #5ed29c; }
.acct-input::placeholder { color: rgba(255,255,255,0.2); }

.acct-label {
  font-family: 'Inter', sans-serif;
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.08em;
  color: rgba(255,255,255,0.3);
  text-transform: uppercase;
}

.acct-save {
  width: 100%;
  padding: 8px;
  border-radius: 6px;
  border: none;
  background: #5ed29c;
  color: #070b0a;
  font-family: 'Inter', sans-serif;
  font-size: 12px;
  font-weight: 800;
  letter-spacing: 0.06em;
  cursor: pointer;
  transition: background 0.2s;
}
.acct-save:hover { background: #79e8b4; }
.acct-save:disabled { opacity: 0.4; cursor: not-allowed; }
`;

function injectStyles() {
    if (document.getElementById('acct-styles')) return;
    const el = document.createElement('style');
    el.id = 'acct-styles';
    el.textContent = STYLES;
    document.head.appendChild(el);
}

export default function AccountDropdown({ open, onClose }) {
    const navigate = useNavigate();
    const ref = useRef(null);
    const userId = localStorage.getItem('userId');

    const [user, setUser] = useState(null);
    const [name, setName] = useState('');
    const [email, setEmail] = useState('');
    const [saving, setSaving] = useState(false);
    const [msg, setMsg] = useState('');
    const [loadFailed, setLoadFailed] = useState(false);

    useEffect(() => { injectStyles(); }, []);

    // Outside click
    useEffect(() => {
        if (!open) return;
        const handler = (e) => {
            if (ref.current && !ref.current.contains(e.target)) onClose();
        };
        document.addEventListener('mousedown', handler);
        return () => document.removeEventListener('mousedown', handler);
    }, [open, onClose]);

    // GSAP entrance
    useEffect(() => {
        if (open && ref.current) {
            gsap.fromTo(ref.current,
                { opacity: 0, y: -8, scale: 0.96 },
                { opacity: 1, y: 0, scale: 1, duration: 0.2, ease: 'power2.out' }
            );
        }
    }, [open]);

    // Fetch user on open
    useEffect(() => {
        if (!userId || !open) return;
        setLoadFailed(false);
        API.get('/users/me').then(res => {
            setUser(res.data);
            setName(res.data.name || '');
            setEmail(res.data.email || '');
        }).catch(() => {
            setUser(null);
            setLoadFailed(true);
        });
    }, [userId, open]);

    const handleSave = async () => {
        setSaving(true);
        setMsg('');
        try {
            await API.put(`/users/${userId}`, { name, email });
            setMsg('Saved');
        } catch {
            setMsg('Error saving');
        } finally { setSaving(false); }
    };

    const handleLogout = () => {
        localStorage.removeItem('token');
        localStorage.removeItem('userId');
        localStorage.removeItem('username');
        setUser(null);
        setName('');
        setEmail('');
        onClose();
    };

    if (!open) return null;

    return (
        <div ref={ref} className="acct-dropdown">
            {!userId ? (
                <>
                    <button className="acct-item" onClick={() => { onClose(); navigate('/login'); }}>Login</button>
                    <div className="acct-divider" />
                    <button className="acct-item" onClick={() => { onClose(); navigate('/login'); }}>Sign Up</button>
                </>
            ) : user ? (
                <>
                    <div style={{ padding: '4px 12px 8px', display: 'flex', flexDirection: 'column', gap: 2 }}>
                        <span style={{ fontFamily: 'Inter, sans-serif', fontSize: 14, fontWeight: 700, color: '#fff' }}>{user.username}</span>
                        <span style={{ fontFamily: 'Inter, sans-serif', fontSize: 11, color: '#5ed29c', fontWeight: 600 }}>{user.elo} ELO</span>
                    </div>
                    <div className="acct-divider" />
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 6, padding: '4px 0' }}>
                        <span className="acct-label">Name</span>
                        <input className="acct-input" placeholder="Your name" value={name} onChange={e => setName(e.target.value)} />
                        <span className="acct-label">Email</span>
                        <input className="acct-input" placeholder="your@email.com" value={email} onChange={e => setEmail(e.target.value)} />
                    </div>
                    <p style={{
                        fontFamily: 'Inter, sans-serif', fontSize: 11,
                        textAlign: 'center', margin: '4px 0',
                        minHeight: 16, color: msg === 'Saved' ? '#5ed29c' : '#ff6b6b',
                    }}>{msg}</p>
                    <button className="acct-save" onClick={handleSave} disabled={saving}>
                        {saving ? 'Saving…' : 'Save'}
                    </button>
                    <div className="acct-divider" />
                    <button className="acct-item" onClick={handleLogout} style={{ color: '#ff6b6b' }}>Logout</button>
                </>
            ) : loadFailed ? (
                <>
                    <div style={{ padding: '8px 12px', color: 'rgba(255,255,255,0.4)', fontFamily: 'Inter, sans-serif', fontSize: 12 }}>
                        Couldn't load your account.
                    </div>
                    <div className="acct-divider" />
                    <button className="acct-item" onClick={handleLogout} style={{ color: '#ff6b6b' }}>Logout</button>
                </>
            ) : (
                <div style={{ padding: '16px', textAlign: 'center', color: 'rgba(255,255,255,0.4)', fontFamily: 'Inter, sans-serif', fontSize: 12 }}>
                    Loading…
                </div>
            )}
        </div>
    );
}
