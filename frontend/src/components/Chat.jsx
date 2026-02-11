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
    const [input, setInput] = useState('');
    const [image, setImage] = useState(null);
    const [pushStatus, setPushStatus] = useState('loading');
    const [recipientId, setRecipientId] = useState(0); // 0 = Global chat
    const socketRef = useRef();
    const messagesEndRef = useRef(null);
    const isFetchingRef = useRef(false);

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

    // Fetch messages from server
    const fetchMessages = useCallback(async () => {
        if (isFetchingRef.current || !user?.id) return;
        isFetchingRef.current = true;
        try {
            // Add timestamp to prevent caching on iOS PWA
            const res = await axios.get(`${API_URL}/messages.php`, {
                params: {
                    sender_id: user.id,
                    recipient_id: recipientId,
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
    }, [user, recipientId]);

    // Connect / reconnect socket
    const connectSocket = useCallback(() => {
        if (socketRef.current?.connected) return;

        if (socketRef.current) {
            socketRef.current.disconnect();
        }

        socketRef.current = io(SOCKET_URL, {
            transports: ['websocket', 'polling'],
            reconnection: true,
            reconnectionAttempts: 3,
            reconnectionDelay: 2000,
            reconnectionDelayMax: 10000,
            timeout: 10000,
        });

        socketRef.current.on('connect', () => {
            console.log('Socket connected');
            fetchMessages();
        });

        socketRef.current.on('chat_message', (msg) => {
            // Only add message if it's relevant to this chat room
            const isRelevant = (String(msg.recipient_id) === String(recipientId) && String(msg.sender_id) === String(user.id)) ||
                (String(msg.recipient_id) === String(user.id) && String(msg.sender_id) === String(recipientId)) ||
                (recipientId === 0 && String(msg.recipient_id) === "0");

            if (!isRelevant) return;

            setMessages((prev) => {
                if (msg.id && prev.some(m => String(m.id) === String(msg.id))) {
                    return prev;
                }
                return [...prev, msg];
            });
        });

        socketRef.current.on('disconnect', (reason) => {
            console.log('Socket disconnected:', reason);
        });
    }, [fetchMessages, user, recipientId]);

    // Detect if running on mobile or as standalone PWA
    const isMobileOrPWA = () => {
        const isStandalone = window.matchMedia('(display-mode: standalone)').matches
            || window.navigator.standalone === true;
        const isMobile = /iPhone|iPad|iPod|Android/i.test(navigator.userAgent);
        return isMobile || isStandalone;
    };

    // Check push notification status on load
    useEffect(() => {
        const initPush = async () => {
            await registerServiceWorker();
            if (!isMobileOrPWA()) {
                setPushStatus('unsupported');
                return;
            }
            if (!isPushSupported()) {
                setPushStatus('unsupported');
                return;
            }
            const status = getNotificationStatus();
            if (status === 'denied') {
                setPushStatus('denied');
                return;
            }
            if (status === 'granted') {
                const hasSubscription = await checkExistingSubscription();
                if (hasSubscription) {
                    setPushStatus('subscribed');
                    if (user?.id) {
                        silentResubscribe(user.id);
                    }
                } else {
                    setPushStatus('prompt');
                }
            } else {
                setPushStatus('prompt');
            }
        };
        initPush();
    }, [user]);

    // Handle push notification enable (USER GESTURE)
    const handleEnablePush = async () => {
        if (!user?.id) return;
        setPushStatus('subscribing');
        const result = await subscribePush(user.id);
        if (result.success) {
            setPushStatus('subscribed');
        } else if (result.reason === 'denied') {
            setPushStatus('denied');
        } else {
            setPushStatus('prompt');
        }
    };

    useEffect(() => {
        connectSocket();
        fetchMessages();
        fetchUsers(); // Fetch users list on load

        const handleVisibilityChange = () => {
            if (document.visibilityState === 'visible') {
                if (!socketRef.current?.connected) {
                    connectSocket();
                }
                fetchMessages();
                fetchUsers();
                if (navigator.clearAppBadge) {
                    navigator.clearAppBadge().catch(() => { });
                }
            }
        };
        document.addEventListener('visibilitychange', handleVisibilityChange);

        const handleSWMessage = (event) => {
            if (event.data && event.data.type === 'NEW_MESSAGE') {
                fetchMessages();
            }
        };
        navigator.serviceWorker?.addEventListener('message', handleSWMessage);

        const handleFocus = () => {
            if (!socketRef.current?.connected) {
                connectSocket();
            }
            fetchMessages();
        };
        window.addEventListener('focus', handleFocus);

        const intervalId = setInterval(() => {
            if (document.visibilityState === 'visible') {
                fetchMessages();
            }
        }, 30000);

        return () => {
            document.removeEventListener('visibilitychange', handleVisibilityChange);
            navigator.serviceWorker?.removeEventListener('message', handleSWMessage);
            window.removeEventListener('focus', handleFocus);
            clearInterval(intervalId);
            socketRef.current?.disconnect();
        };
    }, [user, connectSocket, fetchMessages]);

    useEffect(() => {
        scrollToBottom();
    }, [messages]);

    const scrollToBottom = () => {
        messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    };

    const handleSend = async (e) => {
        e.preventDefault();
        if (!input.trim() && !image) return;

        const formData = new FormData();
        formData.append('sender_id', user.id);
        formData.append('recipient_id', recipientId);
        if (input) formData.append('content', input);
        if (image) formData.append('image', image);

        try {
            await axios.post(`${API_URL}/messages.php`, formData, {
                headers: { 'Content-Type': 'multipart/form-data' }
            });
            setInput('');
            setImage(null);
            fetchMessages(); // Refresh after send
        } catch (err) {
            console.error('Send error:', err);
        }
    };

    const handleFileChange = (e) => {
        if (e.target.files && e.target.files[0]) {
            setImage(e.target.files[0]);
        }
    };

    const parseDate = (dateStr) => {
        if (!dateStr) return new Date();
        // Replace '-' with '/' for iOS Safari compatibility
        return new Date(dateStr.replace(/-/g, '/'));
    };

    const isDifferentDay = (date1, date2) => {
        if (!date1) return true;
        if (!date2) return false;
        const d1 = parseDate(date1);
        const d2 = parseDate(date2);
        return d1.getFullYear() !== d2.getFullYear() ||
            d1.getMonth() !== d2.getMonth() ||
            d1.getDate() !== d2.getDate();
    };

    const formatDate = (dateStr) => {
        const date = parseDate(dateStr);
        if (isNaN(date.getTime())) return '日付不明';
        return `${date.getFullYear()}年${date.getMonth() + 1}月${date.getDate()}日`;
    };

    const formatTime = (dateStr) => {
        const date = parseDate(dateStr);
        if (isNaN(date.getTime())) return '--:--';
        return date.toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit' });
    };

    // Render push notification banner
    const renderPushBanner = () => {
        if (pushStatus === 'prompt') {
            return (
                <div className="push-banner">
                    <span>🔔 通知を有効にすると、新しいメッセージを受信できます</span>
                    <button className="push-enable-btn" onClick={handleEnablePush}>
                        通知を有効にする
                    </button>
                </div>
            );
        }
        if (pushStatus === 'subscribing') {
            return (
                <div className="push-banner push-banner--loading">
                    <span>⏳ 通知を設定中...</span>
                </div>
            );
        }
        if (pushStatus === 'denied') {
            return (
                <div className="push-banner push-banner--denied">
                    <span>🔕 通知がブロックされています。端末の設定から許可してください。</span>
                </div>
            );
        }
        return null;
    };

    return (
        <div className="chat-container">
            {renderPushBanner()}

            <div className="user-selector">
                <div
                    className={`user-item ${recipientId === 0 ? 'active' : ''}`}
                    onClick={() => setRecipientId(0)}
                >
                    <div className="user-avatar global-icon">📢</div>
                    <span className="user-name-label">全体</span>
                </div>
                {users.filter(u => String(u.id) !== String(user.id)).map(u => (
                    <div
                        key={u.id}
                        className={`user-item ${String(recipientId) === String(u.id) ? 'active' : ''}`}
                        onClick={() => setRecipientId(u.id)}
                    >
                        <img src={u.avatar_url} alt="" className="user-avatar" />
                        <span className="user-name-label">{u.name}</span>
                    </div>
                ))}
            </div>

            <div className="messages-list">
                {messages.map((msg, index) => {
                    const isMe = String(msg.sender_id) === String(user.id);
                    const prevMsg = messages[index - 1];
                    const showDateHeader = isDifferentDay(prevMsg?.created_at, msg.created_at);

                    return (
                        <div key={msg.id || index}>
                            {showDateHeader && (
                                <div className="date-header">
                                    <span>{formatDate(msg.created_at)}</span>
                                </div>
                            )}
                            <div className={`message-row ${isMe ? 'my-message' : 'other-message'}`}>
                                {!isMe && <img src={msg.sender_avatar} className="avatar-msg" alt="" />}
                                <div className="message-content">
                                    {msg.sender_name && !isMe && <span className="sender-name">{msg.sender_name}</span>}
                                    <div className="message-bubble-row">
                                        {isMe && <span className="timestamp">{formatTime(msg.created_at)}</span>}
                                        <div className="bubble">
                                            {msg.image_url && <img src={msg.image_url} className="message-image" alt="sent content" />}
                                            {msg.content && <p className="message-text">{msg.content}</p>}
                                        </div>
                                        {!isMe && <span className="timestamp">{formatTime(msg.created_at)}</span>}
                                    </div>
                                </div>
                            </div>
                        </div>
                    );
                })}
                <div ref={messagesEndRef} />
            </div>

            <form className="input-area" onSubmit={handleSend}>
                <label htmlFor="file-upload" className="image-upload-btn">
                    📷
                </label>
                <input
                    id="file-upload"
                    type="file"
                    accept="image/*"
                    style={{ display: 'none' }}
                    onChange={handleFileChange}
                />
                {image && <span className="image-preview">画像選択中</span>}
                <input
                    type="text"
                    value={input}
                    onChange={(e) => setInput(e.target.value)}
                    placeholder="メッセージを入力..."
                />
                <button type="submit" disabled={!input.trim() && !image}>送信</button>
            </form>
        </div>
    );
};

export default Chat;
