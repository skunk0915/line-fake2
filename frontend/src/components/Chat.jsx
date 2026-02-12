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
import { themes } from '../utils/themes';
import './Chat.css';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:8000/api';
const SOCKET_URL = import.meta.env.VITE_SOCKET_URL || 'http://localhost:3000';

const Chat = ({ user }) => {
    const [messages, setMessages] = useState([]);
    const [users, setUsers] = useState([]);
    const [groups, setGroups] = useState([]);
    const [input, setInput] = useState('');
    const [selectedFile, setSelectedFile] = useState(null);
    const [filePreview, setFilePreview] = useState(null);
    const [modalFile, setModalFile] = useState(null);
    const [pushStatus, setPushStatus] = useState('loading');
    const [showPushPrompt, setShowPushPrompt] = useState(false);

    // Chat Selection
    const [recipientId, setRecipientId] = useState(0);
    const [recipientType, setRecipientType] = useState('user'); // 'user', 'group'

    // Group Creation State
    const [isGroupCreateMode, setIsGroupCreateMode] = useState(false);
    const [selectedUserIds, setSelectedUserIds] = useState([]);
    const [newGroupName, setNewGroupName] = useState('');

    // UI States
    const [showAttachmentMenu, setShowAttachmentMenu] = useState(false);
    const [showHamburgerMenu, setShowHamburgerMenu] = useState(false);
    const [currentTheme, setCurrentTheme] = useState(() => {
        return localStorage.getItem('chat_theme') || 'default';
    });
    const [isRecording, setIsRecording] = useState(false);
    const [manualScroll, setManualScroll] = useState(false);

    const socketRef = useRef();
    const messagesEndRef = useRef(null);
    const messagesListRef = useRef(null);
    const isFetchingRef = useRef(false);
    const longPressTimer = useRef(null);
    const mediaRecorderRef = useRef(null);
    const audioChunksRef = useRef([]);

    const activeTheme = themes.find(t => t.id === currentTheme) || themes[0];

    // Fetch user list
    const fetchUsers = useCallback(async () => {
        try {
            const res = await axios.get(`${API_URL}/users.php`);
            if (res.data && res.data.users) {
                setUsers(res.data.users);
            }
        } catch (err) {
            console.error('Fetch users error:', err);
        }
    }, []);

    // Fetch groups
    const fetchGroups = useCallback(async () => {
        try {
            const res = await axios.get(`${API_URL}/groups.php`, {
                params: { user_id: user.id }
            });
            if (res.data && res.data.groups) {
                setGroups(res.data.groups);
            }
        } catch (err) {
            console.error('Fetch groups error:', err);
        }
    }, [user.id]);

    // Fetch messages from server
    const fetchMessages = useCallback(async () => {
        if (isFetchingRef.current || !user?.id) return;
        isFetchingRef.current = true;
        try {
            const res = await axios.get(`${API_URL}/messages.php`, {
                params: {
                    sender_id: user.id,
                    recipient_id: recipientId,
                    recipient_type: recipientType,
                    _t: new Date().getTime()
                }
            });
            if (res.data && res.data.messages) {
                setMessages(res.data.messages);
            }
        } catch (err) {
            console.error('Fetch error:', err);
        } finally {
            isFetchingRef.current = false;
        }
    }, [user, recipientId, recipientType]);

    // Connect / reconnect socket
    const connectSocket = useCallback(() => {
        if (socketRef.current?.connected) return;

        if (socketRef.current) {
            socketRef.current.disconnect();
        }

        socketRef.current = io(SOCKET_URL, {
            transports: ['websocket', 'polling'],
            reconnection: true,
        });

        socketRef.current.on('connect', () => {
            fetchMessages();
        });

        socketRef.current.on('chat_message', (msg) => {
            const isRelevant =
                (msg.recipient_type === 'global' && recipientType === 'global') ||
                (msg.recipient_type === 'group' && recipientType === 'group' && String(msg.recipient_id) === String(recipientId)) ||
                (msg.recipient_type === 'user' && recipientType === 'user' && (
                    (String(msg.sender_id) === String(user.id) && String(msg.recipient_id) === String(recipientId)) ||
                    (String(msg.sender_id) === String(recipientId) && String(msg.recipient_id) === String(user.id))
                ));

            if (!isRelevant) return;

            setMessages((prev) => {
                if (msg.id && prev.some(m => String(m.id) === String(msg.id))) {
                    return prev;
                }
                return [...prev, msg];
            });
        });

        socketRef.current.on('message_deleted', ({ message_id }) => {
            setMessages(prev => prev.map(m =>
                String(m.id) === String(message_id) ? { ...m, is_deleted: true, content: 'メッセージが削除されました' } : m
            ));
        });
    }, [fetchMessages, user, recipientId, recipientType]);

    useEffect(() => {
        // Handle deep link from notification
        const params = new URLSearchParams(window.location.search);
        const chatWith = params.get('chat_with');
        const type = params.get('type') || 'user';
        if (chatWith !== null) {
            setRecipientId(parseInt(chatWith));
            setRecipientType(chatWith === '0' ? 'global' : type);
            // Clean up URL
            window.history.replaceState({}, '', window.location.pathname);
        }
    }, []);

    useEffect(() => {
        const initPush = async () => {
            await registerServiceWorker();
            if (!isPushSupported()) {
                setPushStatus('unsupported');
                return;
            }
            const status = getNotificationStatus();
            if (status === 'granted') {
                const hasSub = await checkExistingSubscription();
                if (hasSub) {
                    setPushStatus('subscribed');
                    silentResubscribe(user.id);
                } else {
                    setPushStatus('prompt');
                    const hasPrompted = localStorage.getItem('push_prompted');
                    if (!hasPrompted) setShowPushPrompt(true);
                }
            } else if (status === 'denied') {
                setPushStatus('denied');
            } else {
                setPushStatus('prompt');
                const hasPrompted = localStorage.getItem('push_prompted');
                if (!hasPrompted) setShowPushPrompt(true);
            }
        };
        initPush();
    }, [user]);

    useEffect(() => {
        connectSocket();
        fetchMessages();
        fetchUsers();
        fetchGroups();

        const handleVisibilityChange = () => {
            if (document.visibilityState === 'visible') {
                fetchMessages();
                if (navigator.clearAppBadge) navigator.clearAppBadge().catch(() => { });
            }
        };
        document.addEventListener('visibilitychange', handleVisibilityChange);

        return () => {
            document.removeEventListener('visibilitychange', handleVisibilityChange);
            socketRef.current?.disconnect();
        };
    }, [user, connectSocket, fetchMessages, fetchUsers, fetchGroups]);

    useEffect(() => {
        if (!manualScroll) {
            scrollToBottom();
        }
    }, [messages, manualScroll]);

    const scrollToBottom = () => {
        messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    };

    const handleScroll = (e) => {
        const { scrollTop, scrollHeight, clientHeight } = e.currentTarget;
        const isAtBottom = scrollHeight - scrollTop - clientHeight < 50;
        if (isAtBottom) {
            setManualScroll(false);
        } else {
            // User scrolled up
            // Don't set manualScroll to true if it was already false and we just scrolled a tiny bit
            // but if they are significantly up, stop auto-scroll
            if (scrollHeight - scrollTop - clientHeight > 100) {
                setManualScroll(true);
            }
        }
    };

    const handleSend = async (e) => {
        if (e) e.preventDefault();
        if (!input.trim() && !selectedFile) return;

        const formData = new FormData();
        formData.append('sender_id', user.id);
        formData.append('recipient_id', recipientId);
        formData.append('recipient_type', recipientType);
        if (input) formData.append('content', input);
        if (selectedFile) {
            formData.append('file', selectedFile);
            formData.append('type', selectedFile.type.split('/')[0] || 'file');
        }

        try {
            const res = await axios.post(`${API_URL}/messages.php`, formData);
            if (res.data.success) {
                setInput('');
                setSelectedFile(null);
                setFilePreview(null);
                setManualScroll(false);
                fetchMessages();
            }
        } catch (err) {
            console.error('Send error:', err);
        }
    };

    const handleFileChange = (e) => {
        const file = e.target.files[0];
        if (!file) return;
        setSelectedFile(file);
        setShowAttachmentMenu(false);

        if (file.type.startsWith('image/')) {
            const reader = new FileReader();
            reader.onloadend = () => setFilePreview({ type: 'image', url: reader.result });
            reader.readAsDataURL(file);
        } else if (file.type.startsWith('video/')) {
            setFilePreview({ type: 'video', url: URL.createObjectURL(file) });
        } else if (file.type.startsWith('audio/')) {
            setFilePreview({ type: 'audio', url: URL.createObjectURL(file) });
        } else {
            setFilePreview({ type: 'file', name: file.name });
        }
    };

    const startRecording = async () => {
        try {
            const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
            const recorder = new MediaRecorder(stream);
            mediaRecorderRef.current = recorder;
            audioChunksRef.current = [];

            recorder.ondataavailable = (e) => {
                if (e.data.size > 0) audioChunksRef.current.push(e.data);
            };

            recorder.onstop = () => {
                const audioBlob = new Blob(audioChunksRef.current, { type: 'audio/wav' });
                const file = new File([audioBlob], 'voice_message.wav', { type: 'audio/wav' });
                setSelectedFile(file);
                setFilePreview({ type: 'audio', url: URL.createObjectURL(audioBlob) });
                stream.getTracks().forEach(track => track.stop());
            };

            recorder.start();
            setIsRecording(true);
            setShowAttachmentMenu(false);
        } catch (err) {
            console.error('Mic error:', err);
            alert('マイクの使用が許可されていません');
        }
    };

    const stopRecording = () => {
        if (mediaRecorderRef.current && isRecording) {
            mediaRecorderRef.current.stop();
            setIsRecording(false);
        }
    };

    const handleDeleteMessage = async (msgId) => {
        if (!window.confirm('このメッセージを削除しますか？')) return;
        try {
            await axios.delete(`${API_URL}/messages.php`, {
                params: { id: msgId, user_id: user.id }
            });
            setMessages(prev => prev.map(m =>
                String(m.id) === String(msgId) ? { ...m, is_deleted: true, content: 'メッセージが削除されました' } : m
            ));
        } catch (err) {
            console.error('Delete error:', err);
        }
    };

    const handleLongPress = (msg) => {
        if (String(msg.sender_id) === String(user.id) && !msg.is_deleted) {
            handleDeleteMessage(msg.id);
        }
    };

    const onTouchStart = (msg) => {
        longPressTimer.current = setTimeout(() => handleLongPress(msg), 800);
    };

    const onTouchEnd = () => {
        if (longPressTimer.current) clearTimeout(longPressTimer.current);
    };

    const handleCreateGroup = async () => {
        if (!newGroupName.trim() || selectedUserIds.length < 1) {
            alert('グループ名とメンバーを選択してください');
            return;
        }
        try {
            const res = await axios.post(`${API_URL}/groups.php`, {
                name: newGroupName,
                user_ids: [...selectedUserIds, user.id]
            });
            if (res.data.success) {
                setNewGroupName('');
                setSelectedUserIds([]);
                setIsGroupCreateMode(false);
                fetchGroups();
                setRecipientId(res.data.group.id);
                setRecipientType('group');
            }
        } catch (err) {
            console.error('Group create error:', err);
        }
    };

    const toggleTheme = (themeId) => {
        setCurrentTheme(themeId);
        localStorage.setItem('chat_theme', themeId);
        setShowHamburgerMenu(false);
    };

    const handleFileDownload = async (url, fileName) => {
        // Try Web Share API for mobile devices (especially iOS)
        if (navigator.share && navigator.canShare) {
            try {
                const response = await fetch(url);
                const blob = await response.blob();
                const file = new File([blob], fileName || 'download', { type: blob.type });

                if (navigator.canShare({ files: [file] })) {
                    await navigator.share({
                        files: [file],
                        title: fileName || 'Download',
                    });
                    return;
                }
            } catch (err) {
                console.error('Share error:', err);
            }
        }

        // Fallback for desktop or failed sharing
        const link = document.createElement('a');
        link.href = url;
        link.download = fileName || 'download';
        link.target = '_blank';
        link.rel = 'noopener noreferrer';
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
    };

    return (
        <div className="chat-container" style={{ background: activeTheme.background }}>
            <div className="selector-wrapper">
                <div className="user-selector">
                    {groups.map(g => (
                        <div
                            key={`g-${g.id}`}
                            className={`user-item ${recipientType === 'group' && String(recipientId) === String(g.id) ? 'active' : ''}`}
                            onClick={() => { setRecipientId(g.id); setRecipientType('group'); setManualScroll(false); }}
                        >
                            <div className="user-avatar group-icon">👥</div>
                            <span className="user-name-label">{g.name}</span>
                        </div>
                    ))}

                    {users.filter(u => String(u.id) !== String(user.id)).map(u => (
                        <div
                            key={u.id}
                            className={`user-item ${recipientType === 'user' && String(recipientId) === String(u.id) ? 'active' : ''}`}
                            onClick={() => { setRecipientId(u.id); setRecipientType('user'); setManualScroll(false); }}
                        >
                            <img src={u.avatar_url} alt="" className="user-avatar" />
                            <span className="user-name-label">{u.name}</span>
                        </div>
                    ))}

                    <button className="add-group-btn" onClick={() => setIsGroupCreateMode(true)}>+</button>
                    <div className="spacer-for-menu"></div>
                </div>
                <button className="menu-trigger-overlay" onClick={() => setShowHamburgerMenu(!showHamburgerMenu)}>☰</button>
            </div>

            {showHamburgerMenu && (
                <div className="hamburger-menu">
                    <div className="menu-header">設定</div>

                    <div className="menu-item-group">
                        <label>通知設定</label>
                        <div className="notification-settings">
                            {pushStatus === 'unsupported' && (
                                <p className="status-msg warning">このブラウザは通知に対応していません</p>
                            )}
                            {pushStatus === 'denied' && (
                                <p className="status-msg error">通知がブロックされています。設定から許可してください。</p>
                            )}
                            {pushStatus === 'subscribed' && (
                                <p className="status-msg success">✅ 通知は有効です</p>
                            )}
                            {(pushStatus === 'prompt' || pushStatus === 'denied' || pushStatus === 'subscribed') && (
                                <div className="notification-actions">
                                    <button
                                        className={`push-btn ${pushStatus === 'subscribed' ? 'active' : ''}`}
                                        onClick={async (e) => {
                                            e.stopPropagation();
                                            const result = await subscribePush(user.id);
                                            if (result.success) setPushStatus('subscribed');
                                            else if (result.reason === 'denied') setPushStatus('denied');
                                            else alert('通知の設定に失敗しました: ' + (result.reason || 'unknown'));
                                        }}
                                    >
                                        {pushStatus === 'subscribed' ? '通知設定を更新' : '通知を有効にする'}
                                    </button>
                                    <p className="ios-hint">※ iOSでは「ホーム画面に追加」してから設定してください</p>
                                </div>
                            )}
                        </div>
                    </div>

                    <div className="menu-item-group">
                        <label>テーマ変更</label>
                        <div className="theme-grid">
                            {themes.map(t => (
                                <div
                                    key={t.id}
                                    className={`theme-option ${currentTheme === t.id ? 'active' : ''}`}
                                    onClick={() => toggleTheme(t.id)}
                                >
                                    <div className="theme-preview" style={{ background: t.background }}></div>
                                    <span>{t.name}</span>
                                </div>
                            ))}
                        </div>
                    </div>
                </div>
            )}

            {isGroupCreateMode && (
                <div className="group-modal">
                    <div className="group-modal-content">
                        <h4>グループ作成</h4>
                        <input
                            type="text"
                            placeholder="グループ名"
                            value={newGroupName}
                            onChange={e => setNewGroupName(e.target.value)}
                        />
                        <div className="member-selection">
                            {users.filter(u => String(u.id) !== String(user.id)).map(u => (
                                <label key={u.id} className="member-item">
                                    <input
                                        type="checkbox"
                                        checked={selectedUserIds.includes(u.id)}
                                        onChange={(e) => {
                                            if (e.target.checked) setSelectedUserIds([...selectedUserIds, u.id]);
                                            else setSelectedUserIds(selectedUserIds.filter(id => id !== u.id));
                                        }}
                                    />
                                    <img src={u.avatar_url} alt="" className="avatar-small" />
                                    <span>{u.name}</span>
                                </label>
                            ))}
                        </div>
                        <div className="modal-actions">
                            <button onClick={() => setIsGroupCreateMode(false)}>キャンセル</button>
                            <button className="primary" onClick={handleCreateGroup}>作成</button>
                        </div>
                    </div>
                </div>
            )}

            <div className="messages-list" ref={messagesListRef} onScroll={handleScroll}>
                {messages.map((msg, index) => {
                    const isMe = String(msg.sender_id) === String(user.id);
                    const prevMsg = messages[index - 1];
                    const showDateHeader = index === 0 ||
                        new Date(msg.created_at).toDateString() !== new Date(prevMsg.created_at).toDateString();

                    return (
                        <div key={msg.id || index}>
                            {showDateHeader && (
                                <div className="date-header">
                                    <span>{new Date(msg.created_at).toLocaleDateString('ja-JP', { year: 'numeric', month: 'long', day: 'numeric' })}</span>
                                </div>
                            )}
                            <div
                                className={`message-row ${isMe ? 'my-message' : 'other-message'}`}
                                onTouchStart={() => onTouchStart(msg)}
                                onTouchEnd={onTouchEnd}
                                onMouseDown={() => onTouchStart(msg)}
                                onMouseUp={onTouchEnd}
                            >
                                {!isMe && <img src={msg.sender_avatar} className="avatar-msg" alt="" />}
                                <div className="message-content">
                                    {msg.sender_name && !isMe && <span className="sender-name">{msg.sender_name}</span>}
                                    <div className="message-bubble-row">
                                        {isMe && <span className="timestamp">{new Date(msg.created_at).toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit' })}</span>}
                                        <div className="bubble" data-deleted={msg.is_deleted}>
                                            {msg.type === 'image' && msg.file_url && (
                                                <img
                                                    src={msg.file_url}
                                                    className="message-image"
                                                    alt="sent"
                                                    onClick={() => setModalFile(msg)}
                                                />
                                            )}
                                            {msg.type === 'video' && msg.file_url && (
                                                <video src={msg.file_url} controls className="message-video" />
                                            )}
                                            {msg.type === 'audio' && msg.file_url && (
                                                <audio src={msg.file_url} controls className="message-audio" />
                                            )}
                                            {msg.type === 'file' && msg.file_url && (
                                                <div className="file-attachment" onClick={() => handleFileDownload(msg.file_url, msg.file_name)}>
                                                    <span className="file-icon">📄</span>
                                                    <span className="file-name">{msg.file_name || 'ファイル'}</span>
                                                </div>
                                            )}
                                            {msg.content && <p className="message-text">{msg.content}</p>}
                                        </div>
                                        {!isMe && <span className="timestamp">{new Date(msg.created_at).toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit' })}</span>}
                                    </div>
                                </div>
                            </div>
                        </div>
                    );
                })}
                <div ref={messagesEndRef} />
            </div>

            <form className="input-area" onSubmit={handleSend}>
                <button type="button" className="attachment-toggle" onClick={() => setShowAttachmentMenu(!showAttachmentMenu)}>+</button>

                {showAttachmentMenu && (
                    <div className="attachment-menu">
                        <label className="menu-item">
                            📷 画像
                            <input type="file" accept="image/*" onChange={handleFileChange} style={{ display: 'none' }} />
                        </label>
                        <label className="menu-item">
                            🎥 動画
                            <input type="file" accept="video/*" onChange={handleFileChange} style={{ display: 'none' }} />
                        </label>
                        <button type="button" className="menu-item" onClick={isRecording ? stopRecording : startRecording}>
                            {isRecording ? '🛑 停止' : '🎤 音声'}
                        </button>
                        <label className="menu-item">
                            📁 ファイル
                            <input type="file" onChange={handleFileChange} style={{ display: 'none' }} />
                        </label>
                    </div>
                )}

                {filePreview && (
                    <div className="file-preview-bar">
                        {filePreview.type === 'image' && <img src={filePreview.url} alt="" />}
                        {filePreview.type === 'video' && <div className="preview-icon">🎥</div>}
                        {filePreview.type === 'audio' && <div className="preview-icon">🎤</div>}
                        {filePreview.type === 'file' && <div className="preview-icon">📄</div>}
                        <span className="preview-name">{filePreview.name || '添付ファイル'}</span>
                        <button type="button" onClick={() => { setSelectedFile(null); setFilePreview(null); }}>✕</button>
                    </div>
                )}

                <input
                    type="text"
                    value={input}
                    onChange={(e) => setInput(e.target.value)}
                    placeholder={isRecording ? "録音中..." : "メッセージを入力..."}
                    readOnly={isRecording}
                />
                <button type="submit" disabled={(!input.trim() && !selectedFile) || isRecording}>送信</button>
            </form>

            {modalFile && (
                <div className="image-modal" onClick={() => setModalFile(null)}>
                    <span className="close-modal" onClick={() => setModalFile(null)}>✕</span>
                    <div className="modal-content" onClick={e => e.stopPropagation()}>
                        <img src={modalFile.file_url} alt="full preview" />
                        <div className="modal-actions-bar">
                            <button className="save-btn" onClick={() => handleFileDownload(modalFile.file_url, modalFile.file_name || 'image.jpg')}>
                                💾 保存 / 共有
                            </button>
                        </div>
                        <p className="modal-hint">※ 保存できない場合は画像を長押ししてください</p>
                    </div>
                </div>
            )}

            {showPushPrompt && (
                <div className="push-prompt-overlay" onClick={() => { setShowPushPrompt(false); localStorage.setItem('push_prompted', 'true'); }}>
                    <div className="push-prompt-card" onClick={e => e.stopPropagation()}>
                        <div className="push-prompt-icon">🔔</div>
                        <h3>通知を有効にしますか？</h3>
                        <p>メッセージが届いた際、リアルタイムでお知らせします。</p>
                        <div className="push-prompt-actions">
                            <button className="secondary" onClick={() => { setShowPushPrompt(false); localStorage.setItem('push_prompted', 'true'); }}>後で</button>
                            <button className="primary" onClick={async () => {
                                const result = await subscribePush(user.id);
                                if (result.success) setPushStatus('subscribed');
                                setShowPushPrompt(false);
                                localStorage.setItem('push_prompted', 'true');
                            }}>有効にする</button>
                        </div>
                        <p className="ios-hint">※ iOSの方はホーム画面に追加してから有効にしてください</p>
                    </div>
                </div>
            )}
        </div>
    );
};

export default Chat;
