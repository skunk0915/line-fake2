import { useState, useEffect, useRef, useCallback } from 'react';
import { io } from 'socket.io-client';
import axios from 'axios';
import { registerPush } from '../utils/push';
import './Chat.css';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:8000/api';
const SOCKET_URL = import.meta.env.VITE_SOCKET_URL || 'http://localhost:3000';

const Chat = ({ user }) => {
    const [messages, setMessages] = useState([]);
    const [input, setInput] = useState('');
    const [image, setImage] = useState(null);
    const socketRef = useRef();
    const messagesEndRef = useRef(null);
    const isFetchingRef = useRef(false);

    // Fetch messages from server
    const fetchMessages = useCallback(async () => {
        if (isFetchingRef.current) return;
        isFetchingRef.current = true;
        try {
            const res = await axios.get(`${API_URL}/messages.php`);
            if (res.data && res.data.messages) {
                setMessages(res.data.messages);
            }
        } catch (err) {
            console.error('Fetch error:', err);
        } finally {
            isFetchingRef.current = false;
        }
    }, []);

    // Connect / reconnect socket
    const connectSocket = useCallback(() => {
        if (socketRef.current?.connected) return;

        if (socketRef.current) {
            socketRef.current.disconnect();
        }

        socketRef.current = io(SOCKET_URL, {
            transports: ['websocket', 'polling'],
            reconnection: true,
            reconnectionAttempts: Infinity,
            reconnectionDelay: 1000,
            reconnectionDelayMax: 5000,
            timeout: 20000,
        });

        socketRef.current.on('connect', () => {
            console.log('Socket connected');
            // Re-fetch messages on reconnect to catch anything missed
            fetchMessages();
        });

        socketRef.current.on('chat_message', (msg) => {
            setMessages((prev) => {
                // Prevent duplicate messages by checking id
                if (msg.id && prev.some(m => String(m.id) === String(msg.id))) {
                    return prev;
                }
                return [...prev, msg];
            });
        });

        socketRef.current.on('disconnect', (reason) => {
            console.log('Socket disconnected:', reason);
        });
    }, [fetchMessages]);

    useEffect(() => {
        // 1. Connect Socket
        connectSocket();

        // 2. Fetch History
        fetchMessages();

        // 3. Register Push
        if (user && user.id) {
            registerPush(user.id);
        }

        // 4. Handle visibility change (iOS kills WebSocket in background)
        const handleVisibilityChange = () => {
            if (document.visibilityState === 'visible') {
                console.log('App became visible, refreshing...');
                // Reconnect socket if disconnected
                if (!socketRef.current?.connected) {
                    connectSocket();
                }
                // Always re-fetch messages when coming back to foreground
                fetchMessages();
            }
        };
        document.addEventListener('visibilitychange', handleVisibilityChange);

        // 5. Handle Service Worker messages (push notification received while app is open)
        const handleSWMessage = (event) => {
            if (event.data && event.data.type === 'NEW_MESSAGE') {
                fetchMessages();
            }
        };
        navigator.serviceWorker?.addEventListener('message', handleSWMessage);

        // 6. Handle page focus (additional fallback for iOS)
        const handleFocus = () => {
            if (!socketRef.current?.connected) {
                connectSocket();
            }
            fetchMessages();
        };
        window.addEventListener('focus', handleFocus);

        // 7. Periodic check as final fallback (every 30s if tab is visible)
        const intervalId = setInterval(() => {
            if (document.visibilityState === 'visible') {
                if (!socketRef.current?.connected) {
                    connectSocket();
                }
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
        if (input) formData.append('content', input);
        if (image) formData.append('image', image);

        try {
            await axios.post(`${API_URL}/messages.php`, formData, {
                headers: { 'Content-Type': 'multipart/form-data' }
            });
            setInput('');
            setImage(null);
        } catch (err) {
            console.error('Send error:', err);
        }
    };

    const handleFileChange = (e) => {
        if (e.target.files && e.target.files[0]) {
            setImage(e.target.files[0]);
        }
    };

    return (
        <div className="chat-container">
            <header className="chat-header">
                <h1>Chat Room</h1>
                <div className="user-info">
                    <img src={user.avatar_url} alt={user.name} className="avatar-small" />
                    <span>{user.name}</span>
                </div>
            </header>

            <div className="messages-list">
                {messages.map((msg, index) => {
                    const isMe = String(msg.sender_id) === String(user.id);
                    return (
                        <div key={msg.id || index} className={`message-row ${isMe ? 'my-message' : 'other-message'}`}>
                            {!isMe && <img src={msg.sender_avatar} className="avatar-msg" alt="" />}
                            <div className="message-content">
                                {msg.sender_name && !isMe && <span className="sender-name">{msg.sender_name}</span>}
                                {msg.image_url && <img src={msg.image_url} className="message-image" alt="sent content" />}
                                {msg.content && <p className="message-text">{msg.content}</p>}
                                <span className="timestamp">{new Date(msg.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
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
                {image && <span className="image-preview">Image selected</span>}
                <input
                    type="text"
                    value={input}
                    onChange={(e) => setInput(e.target.value)}
                    placeholder="Type a message..."
                />
                <button type="submit">Send</button>
            </form>
        </div>
    );
};

export default Chat;
