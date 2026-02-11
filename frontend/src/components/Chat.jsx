import { useState, useEffect, useRef } from 'react';
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

    useEffect(() => {
        // 1. Connect Socket
        socketRef.current = io(SOCKET_URL);

        socketRef.current.on('chat_message', (msg) => {
            setMessages((prev) => [...prev, msg]);
        });

        // 2. Fetch History
        const fetchMessages = async () => {
            try {
                const res = await axios.get(`${API_URL}/messages.php`);
                if (res.data && res.data.messages) {
                    setMessages(res.data.messages);
                }
            } catch (err) {
                console.error('Fetch error:', err);
            }
        };
        fetchMessages();

        // 3. Register Push
        if (user && user.id) {
            registerPush(user.id);
        }

        return () => {
            socketRef.current.disconnect();
        };
    }, [user]);

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
            // Optimistic 
            // Actually wait for server ack via socket usually, 
            // but here we just POST and let socket receive it back.
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
                        <div key={index} className={`message-row ${isMe ? 'my-message' : 'other-message'}`}>
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
