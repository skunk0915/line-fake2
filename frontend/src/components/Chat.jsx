import { useState, useEffect, useRef, useCallback } from 'react';
import { io } from 'socket.io-client';
import axios from 'axios';
import {
    registerServiceWorker,
    subscribePush,
    silentResubscribe,
    isPushSupported,
    getNotificationStatus,
    checkExistingSubscription
} from '../utils/push';
import './Chat.css';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:8000/api';
const SOCKET_URL = import.meta.env.VITE_SOCKET_URL || 'http://localhost:3000';

const Chat = ({ user }) => {
    const [messages, setMessages] = useState([]);
    const [users, setUsers] = useState([]);
    const [groups, setGroups] = useState([]);
    const [input, setInput] = useState('');

    // File upload (image, video, audio)
    const [file, setFile] = useState(null);
    const [filePreview, setFilePreview] = useState(null);
    const [fileType, setFileType] = useState('image'); // 'image', 'video', 'audio'

    const [showPreviewModal, setShowPreviewModal] = useState(false); // For previewing before send
    const [selectedImage, setSelectedImage] = useState(null); // For viewing received images

    const [pushStatus, setPushStatus] = useState('loading');

    // Chat Selection
    const [recipientId, setRecipientId] = useState(0); // 0 = Global
    const [recipientType, setRecipientType] = useState('user'); // 'user' (includes global 0) or 'group'

    // Create Group Modal
    const [showCreateGroup, setShowCreateGroup] = useState(false);
    const [newGroupName, setNewGroupName] = useState('');
    const [groupMembers, setGroupMembers] = useState([]);

    // Recording
    const [isRecording, setIsRecording] = useState(false);
    const mediaRecorderRef = useRef(null);
    const audioChunksRef = useRef([]);

    const socketRef = useRef();
    const messagesEndRef = useRef(null);
    const isFetchingRef = useRef(false);

    // Initial Load & URL Params
    useEffect(() => {
        const params = new URLSearchParams(window.location.search);
        const urlReqId = params.get('recipient_id');
        const urlReqType = params.get('recipient_type');

        if (urlReqId) {
            setRecipientId(parseInt(urlReqId, 10));
            if (urlReqType === 'group') {
                setRecipientType('group');
            } else {
                setRecipientType('user');
            }
        }
    }, []);

    // Fetch Data (Users & Groups)
    const fetchData = useCallback(async () => {
        if (!user?.id) return;
        try {
            const [uRes, gRes] = await Promise.all([
                axios.get(`${API_URL}/users.php`),
                axios.get(`${API_URL}/groups.php?user_id=${user.id}`)
            ]);

            if (uRes.data?.users) setUsers(uRes.data.users);
            if (gRes.data?.groups) setGroups(gRes.data.groups);
        } catch (err) {
            console.error('Fetch data error:', err);
        }
    }, [user]);

    // Fetch messages from server
    const fetchMessages = useCallback(async () => {
        if (isFetchingRef.current || !user?.id) return;
        isFetchingRef.current = true;
        try {
            const res = await axios.get(`${API_URL}/messages.php`, {
                params: {
                    sender_id: user.id,
                    recipient_id: recipientId,
                    recipient_type: recipientId === 0 ? 'user' : recipientType, // 0 is treated as user/global
                    _t: new Date().getTime()
                }
            });
            if (res.data && res.data.messages) {
                setMessages(res.data.messages);
            }
        } catch (err) {
            console.error('Fetch messages error:', err);
        } finally {
            isFetchingRef.current = false;
        }
    }, [user, recipientId, recipientType]);

    // Connect Socket
    const connectSocket = useCallback(() => {
        if (socketRef.current?.connected) return;
        if (socketRef.current) socketRef.current.disconnect();

        socketRef.current = io(SOCKET_URL, {
            transports: ['websocket', 'polling'],
            reconnection: true,
            reconnectionAttempts: 3,
        });

        socketRef.current.on('connect', () => {
            console.log('Socket connected');
            fetchMessages();
        });

        socketRef.current.on('chat_message', (msg) => {
            // Determine relevance
            // If group message
            if (msg.recipient_type === 'group') {
                if (recipientType === 'group' && String(msg.recipient_id) === String(recipientId)) {
                    setMessages(prev => {
                        if (msg.id && prev.some(m => String(m.id) === String(msg.id))) return prev;
                        return [...prev, msg];
                    });
                }
                return;
            }

            // If user message (global or 1-on-1)
            // Logic similar to before but handle type
            let isRelevant = false;

            if (msg.recipient_id == 0) {
                // Global
                isRelevant = (recipientId === 0);
            } else {
                // 1-on-1
                isRelevant = (
                    (String(msg.recipient_id) === String(recipientId) && String(msg.sender_id) === String(user.id)) ||
                    (String(msg.recipient_id) === String(user.id) && String(msg.sender_id) === String(recipientId))
                );
            }

            if (isRelevant) {
                setMessages(prev => {
                    if (msg.id && prev.some(m => String(m.id) === String(msg.id))) return prev;
                    return [...prev, msg];
                });
            }
        });

        socketRef.current.on('disconnect', () => { });
    }, [fetchMessages, user, recipientId, recipientType]);

    // Push Notification Setup
    useEffect(() => {
        const initPush = async () => {
            await registerServiceWorker();
            // (Skipping mobile check for simplicity or user request)
            if (!isPushSupported()) {
                setPushStatus('unsupported');
                return;
            }
            const status = getNotificationStatus();
            if (status === 'granted') {
                if (await checkExistingSubscription()) {
                    setPushStatus('subscribed');
                    if (user?.id) silentResubscribe(user.id);
                } else setPushStatus('prompt');
            } else if (status === 'denied') {
                setPushStatus('denied');
            } else {
                setPushStatus('prompt');
            }
        };
        initPush();
    }, [user]);

    const handleEnablePush = async () => {
        if (!user?.id) return;
        setPushStatus('subscribing');
        const result = await subscribePush(user.id);
        if (result.success) setPushStatus('subscribed');
        else if (result.reason === 'denied') setPushStatus('denied');
        else setPushStatus('prompt');
    };

    // General Effects
    useEffect(() => {
        connectSocket();
        fetchMessages();
        fetchData();

        const handleFocus = () => {
            if (!socketRef.current?.connected) connectSocket();
            fetchMessages();
            fetchData(); // Refresh groups too
        };
        const intervalId = setInterval(() => {
            if (document.visibilityState === 'visible') fetchMessages();
        }, 10000);

        window.addEventListener('focus', handleFocus);
        return () => {
            window.removeEventListener('focus', handleFocus);
            clearInterval(intervalId);
            socketRef.current?.disconnect();
        };
    }, [user, connectSocket, fetchMessages, fetchData]);

    useEffect(() => {
        scrollToBottom();
    }, [messages]);

    const scrollToBottom = () => messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });

    // Send Helpers
    const handleSend = async (e) => {
        e.preventDefault();
        if (!input.trim() && !file) return;

        const formData = new FormData();
        formData.append('sender_id', user.id);
        formData.append('recipient_id', recipientId);
        formData.append('recipient_type', recipientId === 0 ? 'user' : recipientType);

        if (input) formData.append('content', input);
        if (file) formData.append('file', file);

        try {
            await axios.post(`${API_URL}/messages.php`, formData, {
                headers: { 'Content-Type': 'multipart/form-data' }
            });
            setInput('');
            setFile(null);
            setFilePreview(null);
            setFileType('image');
            fetchMessages();
        } catch (err) {
            console.error('Send error:', err);
        }
    };

    const handleFileSelect = (e, type) => {
        if (e.target.files && e.target.files[0]) {
            const f = e.target.files[0];
            setFile(f);
            setFileType(type);
            const reader = new FileReader();
            reader.onloadend = () => setFilePreview(reader.result);
            reader.readAsDataURL(f);
        }
    };

    const startRecording = async () => {
        try {
            const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
            mediaRecorderRef.current = new MediaRecorder(stream);
            audioChunksRef.current = [];

            mediaRecorderRef.current.ondataavailable = event => {
                if (event.data.size > 0) audioChunksRef.current.push(event.data);
            };

            mediaRecorderRef.current.onstop = () => {
                const audioBlob = new Blob(audioChunksRef.current, { type: 'audio/webm' });
                const audioFile = new File([audioBlob], "voice.webm", { type: 'audio/webm' });
                setFile(audioFile);
                setFileType('audio');
                setFilePreview('🎤 音声メッセージ (' + (audioBlob.size / 1024).toFixed(1) + 'KB)');
            };

            mediaRecorderRef.current.start();
            setIsRecording(true);
        } catch (err) {
            console.error("Mic error:", err);
            alert("マイクへのアクセスが許可されていません");
        }
    };

    const stopRecording = () => {
        if (mediaRecorderRef.current && isRecording) {
            mediaRecorderRef.current.stop();
            setIsRecording(false);
            // Stop tracks
            mediaRecorderRef.current.stream.getTracks().forEach(track => track.stop());
        }
    };

    // Group Creation
    const handleCreateGroup = async () => {
        if (!newGroupName.trim() || groupMembers.length === 0) return;
        try {
            const res = await axios.post(`${API_URL}/groups.php`, {
                name: newGroupName,
                created_by: user.id,
                members: groupMembers
            });
            if (res.data.success) {
                setShowCreateGroup(false);
                setNewGroupName('');
                setGroupMembers([]);
                fetchData(); // Refresh groups
            }
        } catch (err) { console.error(err); }
    };

    const toggleGroupMember = (uid) => {
        setGroupMembers(prev => prev.includes(uid) ? prev.filter(id => id !== uid) : [...prev, uid]);
    };

    // Date Formatters
    const formatDate = (d) => {
        const date = new Date(d.replace(/-/g, '/'));
        return isNaN(date) ? '' : `${date.getMonth() + 1}/${date.getDate()}`;
    };
    const formatTime = (d) => {
        const date = new Date(d.replace(/-/g, '/'));
        return isNaN(date) ? '' : date.toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit' });
    };

    return (
        <div className="chat-container">
            {/* Push Banner */}
            {pushStatus === 'prompt' && (
                <div className="push-banner">
                    <span>🔔 通知を有効にする</span>
                    <button className="push-enable-btn" onClick={handleEnablePush}>有効化</button>
                </div>
            )}

            {/* User/Group Selector */}
            <div className="user-selector">
                <div className={`user-item ${recipientId === 0 ? 'active' : ''}`}
                    onClick={() => { setRecipientId(0); setRecipientType('user'); }}>
                    <div className="user-avatar global-icon">📢</div>
                    <span className="user-name-label">全体</span>
                </div>

                {/* Create Group Button */}
                <div className="user-item" onClick={() => setShowCreateGroup(true)}>
                    <div className="user-avatar create-group-icon" style={{ background: '#eee', fontSize: '1.5rem', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>➕</div>
                    <span className="user-name-label">作成</span>
                </div>

                {/* Groups */}
                {groups.map(g => (
                    <div key={`g-${g.id}`}
                        className={`user-item ${recipientType === 'group' && String(recipientId) === String(g.id) ? 'active' : ''}`}
                        onClick={() => { setRecipientId(g.id); setRecipientType('group'); }}>
                        <div className="user-avatar group-icon" style={{ background: '#cceeff', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>👥</div>
                        <span className="user-name-label">{g.name}</span>
                    </div>
                ))}

                {/* Users */}
                {users.filter(u => String(u.id) !== String(user.id)).map(u => (
                    <div key={u.id}
                        className={`user-item ${recipientType === 'user' && recipientId !== 0 && String(recipientId) === String(u.id) ? 'active' : ''}`}
                        onClick={() => { setRecipientId(u.id); setRecipientType('user'); }}>
                        <img src={u.avatar_url} alt="" className="user-avatar" />
                        <span className="user-name-label">{u.name}</span>
                    </div>
                ))}
            </div>

            {/* Messages */}
            <div className="messages-list">
                {messages.map((msg, idx) => {
                    const isMe = String(msg.sender_id) === String(user.id);
                    return (
                        <div key={msg.id || idx} className={`message-row ${isMe ? 'my-message' : 'other-message'}`}>
                            {!isMe && <div className="avatar-wrapper">
                                <img src={msg.sender_avatar} className="avatar-msg" alt="" />
                                {recipientType === 'group' && <span className="sender-name-tiny">{msg.sender_name}</span>}
                            </div>}
                            <div className="message-content">
                                <div className="message-bubble-row">
                                    {isMe && <span className="timestamp">{formatTime(msg.created_at)}</span>}
                                    <div className="bubble">
                                        {msg.content && <p>{msg.content}</p>}
                                        {msg.image_url && (
                                            <>
                                                {msg.type === 'video' ? (
                                                    <video src={msg.image_url} controls className="message-image" />
                                                ) : msg.type === 'audio' ? (
                                                    <audio src={msg.image_url} controls className="message-audio" />
                                                ) : (
                                                    <img
                                                        src={msg.image_url}
                                                        className="message-image"
                                                        alt="content"
                                                        onClick={() => setSelectedImage(msg.image_url)}
                                                    />
                                                )}
                                            </>
                                        )}
                                    </div>
                                    {!isMe && <span className="timestamp">{formatTime(msg.created_at)}</span>}
                                </div>
                            </div>
                        </div>
                    );
                })}
                <div ref={messagesEndRef} />
            </div>

            {/* Input Area */}
            <form className="input-area" onSubmit={handleSend}>
                {/* Image input */}
                <label htmlFor="img-upload" className="icon-btn">📷</label>
                <input id="img-upload" type="file" accept="image/*" style={{ display: 'none' }} onChange={e => handleFileSelect(e, 'image')} />

                {/* Video input */}
                <label htmlFor="vid-upload" className="icon-btn">🎥</label>
                <input id="vid-upload" type="file" accept="video/*" style={{ display: 'none' }} onChange={e => handleFileSelect(e, 'video')} />

                {/* Audio Record */}
                <button type="button" className={`icon-btn ${isRecording ? 'recording' : ''}`}
                    onMouseDown={startRecording} onMouseUp={stopRecording} onTouchStart={startRecording} onTouchEnd={stopRecording}>
                    🎤
                </button>

                {/* Preview */}
                {filePreview && (
                    <div className="preview-mini" onClick={() => setShowPreviewModal(true)}>
                        {fileType === 'image' && <img src={filePreview} alt="preview" />}
                        {fileType !== 'image' && <span>{fileType} selected</span>}
                        <button type="button" className="close-preview" onClick={(e) => { e.stopPropagation(); setFile(null); setFilePreview(null); }}>✕</button>
                    </div>
                )}

                <input type="text" value={input} onChange={e => setInput(e.target.value)} placeholder="メッセージ..." />
                <button type="submit" disabled={!input.trim() && !file}>送信</button>
            </form>

            {/* Modals */}
            {selectedImage && (
                <div className="image-modal" onClick={() => setSelectedImage(null)}>
                    <span className="close-modal">✕</span>
                    <img src={selectedImage} alt="full view" onClick={e => e.stopPropagation()} />
                </div>
            )}

            {/* Use selectedImage style modal for create group */}
            {showCreateGroup && (
                <div className="modal-overlay">
                    <div className="create-group-modal">
                        <h3>グループ作成</h3>
                        <input type="text" placeholder="グループ名" value={newGroupName} onChange={e => setNewGroupName(e.target.value)} />
                        <div className="member-select-list">
                            {users.filter(u => String(u.id) !== String(user.id)).map(u => (
                                <label key={u.id} className="member-option">
                                    <input type="checkbox" checked={groupMembers.includes(u.id)} onChange={() => toggleGroupMember(u.id)} />
                                    <img src={u.avatar_url} className="avatar-small" />
                                    {u.name}
                                </label>
                            ))}
                        </div>
                        <div className="modal-actions">
                            <button onClick={() => setShowCreateGroup(false)}>キャンセル</button>
                            <button onClick={handleCreateGroup} className="active">作成</button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};

export default Chat;
