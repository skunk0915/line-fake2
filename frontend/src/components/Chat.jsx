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

const Chat = ({ user, setUser }) => {
    const [messages, setMessages] = useState([]);
    const [users, setUsers] = useState([]);
    const [groups, setGroups] = useState([]);
    const [input, setInput] = useState('');
    const [selectedFile, setSelectedFile] = useState(null);
    const [filePreview, setFilePreview] = useState(null);
    const [modalFile, setModalFile] = useState(null);
    const [pushStatus, setPushStatus] = useState('loading');
    const [showPushPrompt, setShowPushPrompt] = useState(false);
    const [isLoadingMessages, setIsLoadingMessages] = useState(false);

    // Chat Selection
    const [recipientId, setRecipientId] = useState(null);
    const [recipientType, setRecipientType] = useState('user'); // 'user', 'group'

    // Group/Contact Creation State
    const [isGroupCreateMode, setIsGroupCreateMode] = useState(false);
    const [selectedUserIds, setSelectedUserIds] = useState([]);
    const [newGroupName, setNewGroupName] = useState('');
    const [modalMode, setModalMode] = useState('group'); // 'group', 'contact'
    const [inviteEmail, setInviteEmail] = useState('');

    // UI States
    const [showHamburgerMenu, setShowHamburgerMenu] = useState(false);
    const [currentTheme, setCurrentTheme] = useState(() => {
        return localStorage.getItem('chat_theme') || 'default';
    });
    const [isRecording, setIsRecording] = useState(false);
    const [manualScroll, setManualScroll] = useState(false);

    // Profile Edit State
    const [profileName, setProfileName] = useState(user.name);
    const [profileEmail, setProfileEmail] = useState(user.email || '');
    const [profileAvatarFile, setProfileAvatarFile] = useState(null);
    const [profileAvatarPreview, setProfileAvatarPreview] = useState(user.avatar_url);
    const [isUpdatingProfile, setIsUpdatingProfile] = useState(false);

    // Group Edit State
    const [isGroupEditMode, setIsGroupEditMode] = useState(false);
    const [editingGroup, setEditingGroup] = useState(null);
    const [groupEditName, setGroupEditName] = useState('');
    const [groupEditAvatarFile, setGroupEditAvatarFile] = useState(null);
    const [groupEditAvatarPreview, setGroupEditAvatarPreview] = useState('');
    const [isUpdatingGroup, setIsUpdatingGroup] = useState(false);
    const [editingGroupMembers, setEditingGroupMembers] = useState([]);
    const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
    const [deleteConfirmCode, setDeleteConfirmCode] = useState('');
    const [userInputDeleteCode, setUserInputDeleteCode] = useState('');

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
            const res = await axios.get(`${API_URL}/users.php`, {
                params: { my_id: user.id }
            });
            if (res.data && res.data.users) {
                setUsers(res.data.users);
                // If no recipient selected yet, select the first other user
                if (!recipientId && res.data.users.length > 0) {
                    const firstOther = res.data.users.find(u => String(u.id) !== String(user.id));
                    if (firstOther) {
                        setRecipientId(firstOther.id);
                        setRecipientType('user');
                    }
                }
            }
        } catch (err) {
            console.error('Fetch users error:', err);
        }
    }, [user.id, recipientId]);

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
        setIsLoadingMessages(true);
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
            setIsLoadingMessages(false);
        }
    }, [user, recipientId, recipientType]);

    const markRead = useCallback(async () => {
        if (!user?.id || !recipientId || recipientType === 'global') return;
        try {
            const formData = new FormData();
            formData.append('sender_id', user.id);
            formData.append('recipient_id', recipientId);
            formData.append('recipient_type', recipientType);
            await axios.post(`${API_URL}/messages.php?action=mark_read`, formData);
            // Refresh counts to update badges in the list
            const resU = await axios.get(`${API_URL}/users.php`, { params: { my_id: user.id } });
            if (resU.data?.users) setUsers(resU.data.users);
            const resG = await axios.get(`${API_URL}/groups.php`, { params: { user_id: user.id } });
            if (resG.data?.groups) setGroups(resG.data.groups);
        } catch (err) {
            console.error('Mark read error:', err);
        }
    }, [user.id, recipientId, recipientType]);

    // Intersection Observer to detect when user sees the bottom of the chat
    useEffect(() => {
        if (!messagesEndRef.current || !recipientId) return;
        const observer = new IntersectionObserver(
            ([entry]) => {
                if (entry.isIntersecting) {
                    markRead();
                }
            },
            { threshold: 0.1 }
        );
        observer.observe(messagesEndRef.current);
        return () => observer.disconnect();
    }, [markRead, messages.length, recipientId]);

    // Connect / reconnect socket
    const connectSocket = useCallback(() => {
        if (socketRef.current?.connected) return;

        if (socketRef.current) {
            socketRef.current.disconnect();
        }

        socketRef.current = io(SOCKET_URL, {
            transports: ['polling', 'websocket'],
            reconnection: true,
            path: '/socket.io',
            secure: true,
            rejectUnauthorized: false
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

        socketRef.current.on('group_updated', () => {
            fetchGroups();
            fetchUsers();
        });

        socketRef.current.on('user_updated', () => {
            fetchUsers();
            fetchGroups();
        });
    }, [fetchMessages, fetchUsers, fetchGroups, user, recipientId, recipientType]);

    useEffect(() => {
        // Handle deep link (notifications & invitations)
        const parseUrlParams = (urlStr) => {
            const url = new URL(urlStr, window.location.origin);
            const params = url.searchParams;

            const invToken = params.get('invitation_token');
            if (invToken && user) {
                axios.post(`${API_URL}/claim_invite.php`, {
                    user_id: user.id,
                    token: invToken
                })
                    .then(res => {
                        if (res.data.success) {
                            alert('招待を受け取りました！友だちリストに追加されました。');
                            fetchUsers();
                        }
                    })
                    .catch(err => console.error('Claim invite error:', err));
            }

            const chatWith = params.get('chat_with');
            const type = params.get('type') || 'user';
            if (chatWith !== null) {
                setRecipientId(parseInt(chatWith));
                setRecipientType(chatWith === '0' ? 'global' : type);
                setManualScroll(false);
            }
        };

        parseUrlParams(window.location.href);

        const handleSWMessage = (event) => {
            if (event.data?.type === 'NAVIGATE') {
                parseUrlParams(event.data.url);
            }
        };

        if ('serviceWorker' in navigator) {
            navigator.serviceWorker.addEventListener('message', handleSWMessage);
        }

        if (window.location.search) {
            const url = new URL(window.location);
            url.searchParams.delete('chat_with');
            url.searchParams.delete('type');
            url.searchParams.delete('invitation_token');
            window.history.replaceState({}, '', url);
        }

        return () => {
            if ('serviceWorker' in navigator) {
                navigator.serviceWorker.removeEventListener('message', handleSWMessage);
            }
        };
    }, [user, fetchUsers]);

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
                fetchUsers();
                fetchGroups();
                if (navigator.clearAppBadge) navigator.clearAppBadge().catch(() => { });
            }
        };

        const pollInterval = setInterval(() => {
            fetchMessages();
            fetchUsers();
            fetchGroups();
        }, 5000);

        document.addEventListener('visibilitychange', handleVisibilityChange);

        return () => {
            document.removeEventListener('visibilitychange', handleVisibilityChange);
            clearInterval(pollInterval);
            socketRef.current?.disconnect();
        };
    }, [user, connectSocket, fetchMessages, fetchUsers, fetchGroups]);

    const lastMessageCountRef = useRef(0);
    const lastRecipientRef = useRef(null);

    useEffect(() => {
        const recipientKey = `${recipientType}-${recipientId}`;
        const recipientChanged = lastRecipientRef.current !== recipientKey;
        const hasNewMessages = messages.length > lastMessageCountRef.current;

        if (recipientChanged || (hasNewMessages && !manualScroll)) {
            scrollToBottom();
            if (recipientChanged) {
                setManualScroll(false);
                fetchUsers();
                fetchGroups();
            }
        }

        lastMessageCountRef.current = messages.length;
        lastRecipientRef.current = recipientKey;
    }, [messages.length, manualScroll, recipientId, recipientType, fetchUsers, fetchGroups]);

    const scrollToBottom = () => {
        messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    };

    const handleScroll = (e) => {
        const { scrollTop, scrollHeight, clientHeight } = e.currentTarget;
        const isAtBottom = scrollHeight - scrollTop - clientHeight < 20;

        if (isAtBottom) {
            setManualScroll(false);
        } else {
            if (scrollHeight - scrollTop - clientHeight > 30) {
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
            let fileType = 'file';
            if (selectedFile.type.startsWith('image/')) fileType = 'image';
            else if (selectedFile.type.startsWith('video/')) fileType = 'video';
            else if (selectedFile.type.startsWith('audio/')) fileType = 'audio';
            formData.append('type', fileType);
        }

        try {
            const res = await axios.post(`${API_URL}/messages.php`, formData);
            if (res.data.success) {
                setInput('');
                setSelectedFile(null);
                setFilePreview(null);
                setManualScroll(false);
                fetchMessages();
                fetchUsers();
                fetchGroups();
            }
        } catch (err) {
            console.error('Send error:', err);
            alert('送信に失敗しました');
        }
    };

    const handleFileChange = (e) => {
        const file = e.target.files[0];
        if (!file) return;
        setSelectedFile(file);

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

    const handleInviteContact = async () => {
        if (!inviteEmail.trim() || !inviteEmail.includes('@')) {
            alert('有効なメールアドレスを入力してください');
            return;
        }
        try {
            const res = await axios.post(`${API_URL}/invitations.php`, {
                sender_id: user.id,
                email: inviteEmail
            });
            if (res.data.success) {
                alert('招待メールを送信しました！相手が承認するとトークルームが成立します。');
                setInviteEmail('');
                setIsGroupCreateMode(false);
            }
        } catch (err) {
            console.error('Invite error:', err);
            alert('招待に失敗しました');
        }
    };

    const toggleTheme = (themeId) => {
        setCurrentTheme(themeId);
        localStorage.setItem('chat_theme', themeId);
        setShowHamburgerMenu(false);
    };

    const handleProfileUpdate = async (e) => {
        e.preventDefault();
        setIsUpdatingProfile(true);
        if (profileEmail && !profileEmail.endsWith('@gmail.com')) {
            alert('メールアドレスは @gmail.com のみ登録可能です');
            setIsUpdatingProfile(false);
            return;
        }

        const formData = new FormData();
        formData.append('user_id', user.id);
        formData.append('name', profileName);
        if (profileEmail) formData.append('email', profileEmail);
        if (profileAvatarFile) formData.append('avatar', profileAvatarFile);

        try {
            const res = await axios.post(`${API_URL}/users.php`, formData);
            if (res.data.success) {
                const updatedUser = res.data.user;
                setUser(updatedUser);
                localStorage.setItem('chat_user', JSON.stringify(updatedUser));
                setProfileAvatarFile(null);
                alert('プロフィールを更新しました');
            }
        } catch (err) {
            console.error('Profile update error:', err);
            alert('プロフィールの更新に失敗しました');
        } finally {
            setIsUpdatingProfile(false);
        }
    };

    const handleProfileAvatarChange = (e) => {
        const file = e.target.files[0];
        if (!file) return;
        setProfileAvatarFile(file);
        const reader = new FileReader();
        reader.onloadend = () => setProfileAvatarPreview(reader.result);
        reader.readAsDataURL(file);
    };

    const handleGroupUpdate = async (e) => {
        e.preventDefault();
        if (!groupEditName.trim()) return;
        setIsUpdatingGroup(true);
        const formData = new FormData();
        formData.append('group_id', editingGroup.id);
        formData.append('name', groupEditName);
        formData.append('user_ids', JSON.stringify(editingGroupMembers));
        if (groupEditAvatarFile) formData.append('avatar', groupEditAvatarFile);

        try {
            const res = await axios.post(`${API_URL}/groups.php`, formData);
            if (res.data.success) {
                fetchGroups();
                setIsGroupEditMode(false);
                setEditingGroup(null);
                setGroupEditAvatarFile(null);
                alert('グループ情報を更新しました');
            }
        } catch (err) {
            console.error('Group update error:', err);
            alert('グループ情報の更新に失敗しました');
        } finally {
            setIsUpdatingGroup(false);
        }
    };

    const handleGroupAvatarChange = (e) => {
        const file = e.target.files[0];
        if (!file) return;
        setGroupEditAvatarFile(file);
        const reader = new FileReader();
        reader.onloadend = () => setGroupEditAvatarPreview(reader.result);
        reader.readAsDataURL(file);
    };

    const generateDeleteCode = () => {
        const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
        let code = '';
        for (let i = 0; i < 5; i++) {
            code += chars.charAt(Math.floor(Math.random() * chars.length));
        }
        setDeleteConfirmCode(code);
        setUserInputDeleteCode('');
        setShowDeleteConfirm(true);
    };

    const handleDeleteGroup = async () => {
        if (userInputDeleteCode !== deleteConfirmCode) {
            alert('削除コードが一致しません');
            return;
        }
        if (!window.confirm('本当にこのグループを削除しますか？')) return;

        try {
            const res = await axios.delete(`${API_URL}/groups.php`, {
                params: { id: editingGroup.id }
            });
            if (res.data.success) {
                setIsGroupEditMode(false);
                setEditingGroup(null);
                fetchGroups();
                if (recipientType === 'group' && String(recipientId) === String(editingGroup.id)) {
                    setRecipientId(null);
                    setRecipientType('user');
                }
                alert('グループを削除しました');
            }
        } catch (err) {
            console.error('Delete group error:', err);
            alert('グループの削除に失敗しました');
        }
    };

    const onGroupLongPress = async (g) => {
        setEditingGroup(g);
        setGroupEditName(g.name);
        setGroupEditAvatarPreview(g.avatar_url || '');
        setGroupEditAvatarFile(null);
        setIsGroupEditMode(true);
        setShowDeleteConfirm(false);

        try {
            const res = await axios.get(`${API_URL}/groups.php`, {
                params: { group_id: g.id }
            });
            if (res.data && res.data.members) {
                setEditingGroupMembers(res.data.members.map(m => m.id));
            }
        } catch (err) {
            console.error('Fetch members error:', err);
        }
    };

    const groupLongPressTimer = useRef(null);

    const onGroupTouchStart = (g) => {
        groupLongPressTimer.current = setTimeout(() => onGroupLongPress(g), 800);
    };

    const onGroupTouchEnd = () => {
        if (groupLongPressTimer.current) clearTimeout(groupLongPressTimer.current);
    };

    const handleFileDownload = async (url, fileName) => {
        const isMobile = /iPhone|iPad|iPod|Android/i.test(navigator.userAgent);
        if (isMobile && navigator.share) {
            try {
                const response = await fetch(url);
                const blob = await response.blob();
                const file = new File([blob], fileName || 'download', { type: blob.type });
                if (navigator.canShare && navigator.canShare({ files: [file] })) {
                    await navigator.share({ files: [file], title: fileName || 'Download' });
                    return;
                }
            } catch (err) {
                if (err.name === 'AbortError') return;
                console.error('Share error:', err);
            }
        }
        try {
            const response = await fetch(url);
            const blob = await response.blob();
            const blobUrl = URL.createObjectURL(blob);
            const link = document.createElement('a');
            link.href = blobUrl;
            link.download = fileName || 'download';
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
            setTimeout(() => URL.revokeObjectURL(blobUrl), 100);
        } catch (err) {
            console.error('Download error:', err);
            const link = document.createElement('a');
            link.href = url;
            link.download = fileName || 'download';
            link.target = '_blank';
            link.rel = 'noopener noreferrer';
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
        }
    };

    // URL Linkifier
    const renderMessageContent = (content) => {
        const urlRegex = /(https?:\/\/[^\s]+)/g;
        return content.split(urlRegex).map((part, index) => {
            if (part.match(urlRegex)) {
                return (
                    <a
                        key={index}
                        href={part}
                        target="_blank"
                        rel="noopener noreferrer"
                        style={{ color: '#007bff', textDecoration: 'underline', wordBreak: 'break-all' }}
                        onClick={(e) => e.stopPropagation()}
                    >
                        {part}
                    </a>
                );
            }
            return part;
        });
    };

    return (
        <div className={`chat-container ${showHamburgerMenu ? 'menu-active' : ''}`} style={{ background: activeTheme.background }}>
            <div className="selector-wrapper">
                <div className="user-selector">
                    {groups.map(g => (
                        <div
                            key={`g-${g.id}`}
                            className={`user-item ${recipientType === 'group' && String(recipientId) === String(g.id) ? 'active' : ''}`}
                            onClick={() => {
                                if (String(recipientId) !== String(g.id) || recipientType !== 'group') {
                                    setMessages([]);
                                    setRecipientId(g.id);
                                    setRecipientType('group');
                                    setManualScroll(false);
                                }
                            }}
                            onMouseDown={() => onGroupTouchStart(g)}
                            onMouseUp={onGroupTouchEnd}
                            onTouchStart={() => onGroupTouchStart(g)}
                            onTouchEnd={onGroupTouchEnd}
                        >
                            <div className="user-avatar-container">
                                {g.avatar_url ? (
                                    <img src={g.avatar_url} alt="" className="user-avatar" />
                                ) : (
                                    <div className="user-avatar group-icon">👥</div>
                                )}
                                {g.unread_count > 0 && (recipientType !== 'group' || String(recipientId) !== String(g.id)) && <span className="unread-badge">{g.unread_count}</span>}
                            </div>
                            <span className="user-name-label">{g.name}</span>
                        </div>
                    ))}

                    {users.filter(u => String(u.id) !== String(user.id)).map(u => (
                        <div
                            key={u.id}
                            className={`user-item ${recipientType === 'user' && String(recipientId) === String(u.id) ? 'active' : ''}`}
                            onClick={() => {
                                if (String(recipientId) !== String(u.id) || recipientType !== 'user') {
                                    setMessages([]);
                                    setRecipientId(u.id);
                                    setRecipientType('user');
                                    setManualScroll(false);
                                }
                            }}
                        >
                            <div className="user-avatar-container">
                                <img src={u.avatar_url} alt="" className="user-avatar" />
                                {u.unread_count > 0 && (recipientType !== 'user' || String(recipientId) !== String(u.id)) && <span className="unread-badge">{u.unread_count}</span>}
                            </div>
                            <span className="user-name-label">{u.name}</span>
                        </div>
                    ))}

                    <button className="add-group-btn" onClick={() => setIsGroupCreateMode(true)}>+</button>
                    <div className="spacer-for-menu"></div>
                </div>
                <button className="menu-trigger-overlay" onClick={() => setShowHamburgerMenu(!showHamburgerMenu)}>☰</button>
            </div>

            {showHamburgerMenu && (
                <div className="menu-overlay" onClick={() => setShowHamburgerMenu(false)}>
                    <div className="hamburger-menu" onClick={e => e.stopPropagation()}>
                        <div className="menu-header">設定</div>
                        <div className="menu-item-group">
                            <label>プロフィール編集</label>
                            <div className="profile-edit-section">
                                <form onSubmit={handleProfileUpdate} className="profile-edit-form">
                                    <div className="avatar-edit-container">
                                        <img src={profileAvatarPreview || '/default-avatar.png'} alt="Preview" className="avatar-preview-large" />
                                        <label className="avatar-input-label">
                                            写真を変更
                                            <input type="file" accept="image/*" onChange={handleProfileAvatarChange} style={{ display: 'none' }} />
                                        </label>
                                    </div>
                                    <div className="name-input-group">
                                        <input type="text" value={profileName} onChange={e => setProfileName(e.target.value)} placeholder="お名前" required />
                                    </div>
                                    <div className="name-input-group" style={{ marginTop: '10px' }}>
                                        <input type="email" value={profileEmail} onChange={e => setProfileEmail(e.target.value)} placeholder="メールアドレス（通知用）" />
                                    </div>
                                    <button type="submit" className="profile-save-btn" disabled={isUpdatingProfile}>
                                        {isUpdatingProfile ? '更新中...' : '保存'}
                                    </button>
                                </form>
                            </div>
                        </div>

                        <div className="menu-item-group">
                            <label>通知設定</label>
                            <div className="notification-settings">
                                {pushStatus === 'unsupported' && <p className="status-msg warning">このブラウザは通知に対応していません</p>}
                                {pushStatus === 'denied' && <p className="status-msg error">通知がブロックされています。設定から許可してください。</p>}
                                {pushStatus === 'subscribed' && <p className="status-msg success">✅ 通知は有効です</p>}
                                {(pushStatus === 'prompt' || pushStatus === 'denied' || pushStatus === 'subscribed') && (
                                    <div className="notification-actions">
                                        <button
                                            className={`push-btn ${pushStatus === 'subscribed' ? 'active' : ''}`}
                                            onClick={async (e) => {
                                                e.stopPropagation();
                                                const result = await subscribePush(user.id);
                                                if (result.success) setPushStatus('subscribed');
                                                else if (result.reason === 'denied') setPushStatus('denied');
                                                else alert('通知の設定に失敗しました');
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
                                    <div key={t.id} className={`theme-option ${currentTheme === t.id ? 'active' : ''}`} onClick={() => toggleTheme(t.id)}>
                                        <div className="theme-preview" style={{ background: t.background }}></div>
                                        <span>{t.name}</span>
                                    </div>
                                ))}
                            </div>
                        </div>
                    </div>
                </div>
            )}

            <div className={`main-chat ${showHamburgerMenu ? 'menu-open' : ''}`}>
                <div className="messages-list" ref={messagesListRef} onScroll={handleScroll}>
                    {messages.length === 0 && !isLoadingMessages && (
                        <div className="empty-chat">
                            <div className="empty-icon">💬</div>
                            <p>まだメッセージがありません</p>
                        </div>
                    )}

                    {isLoadingMessages && messages.length === 0 && (
                        <div className="loading-container">
                            <div className="loading-spinner-premium"></div>
                            <p>読み込み中...</p>
                        </div>
                    )}

                    {messages.map((msg, index) => {
                        const isMe = String(msg.sender_id) === String(user.id);
                        const prevMsg = messages[index - 1];
                        const showDateHeader = index === 0 || new Date(msg.created_at).toDateString() !== new Date(prevMsg.created_at).toDateString();
                        return (
                            <div key={msg.id || index}>
                                {showDateHeader && (
                                    <div className="date-header">
                                        <span>{new Date(msg.created_at).toLocaleDateString('ja-JP', { year: 'numeric', month: 'long', day: 'numeric' })}</span>
                                    </div>
                                )}
                                <div className={`message-row ${isMe ? 'my-message' : 'other-message'}`} onTouchStart={() => onTouchStart(msg)} onTouchEnd={onTouchEnd} onMouseDown={() => onTouchStart(msg)} onMouseUp={onTouchEnd}>
                                    {!isMe && <img src={msg.sender_avatar} className="avatar-msg" alt="" />}
                                    <div className="message-content">
                                        {msg.sender_name && !isMe && <span className="sender-name">{msg.sender_name}</span>}
                                        <div className="message-bubble-row">
                                            {isMe && <span className="timestamp">{new Date(msg.created_at).toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit' })}</span>}
                                            <div className="bubble" data-deleted={msg.is_deleted}>
                                                {msg.type === 'image' && msg.file_url && <img src={msg.file_url} className="message-image" alt="sent" onClick={() => setModalFile(msg)} />}
                                                {msg.type === 'video' && msg.file_url && <video src={msg.file_url} controls className="message-video" />}
                                                {msg.type === 'audio' && msg.file_url && <audio src={msg.file_url} controls className="message-audio" />}
                                                {msg.type === 'file' && msg.file_url && (
                                                    <div className="file-attachment" onClick={() => handleFileDownload(msg.file_url, msg.file_name)}>
                                                        <span className="file-icon">📄</span>
                                                        <span className="file-name">{msg.file_name || 'ファイル'}</span>
                                                    </div>
                                                )}
                                                {msg.content && <p className="message-text">{renderMessageContent(msg.content)}</p>}
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
                    <div className="input-actions-left">
                        <label className="plus-btn-label">
                            <span className="plus-icon">+</span>
                            <input type="file" onChange={handleFileChange} style={{ display: 'none' }} />
                        </label>
                        <button type="button" className={`mic-btn ${isRecording ? 'recording' : ''}`} onClick={isRecording ? stopRecording : startRecording}>
                            {isRecording ? '🛑' : '🎤'}
                        </button>
                    </div>
                    {filePreview && (
                        <div className="file-preview-bar">
                            {filePreview.type === 'image' && <img src={filePreview.url} alt="" />}
                            {filePreview.type === 'video' && <div className="preview-icon">🎥</div>}
                            {filePreview.type === 'audio' && <div className="preview-icon">🎤</div>}
                            {filePreview.type === 'file' && <div className="preview-icon">📄</div>}
                            <span className="preview-name">{filePreview.name || '添付ファイル'}</span>
                            <button type="button" className="close-preview" onClick={() => { setSelectedFile(null); setFilePreview(null); }}>✕</button>
                        </div>
                    )}
                    <input type="text" value={input} onChange={(e) => setInput(e.target.value)} placeholder={isRecording ? "録音中..." : "メッセージを入力..."} readOnly={isRecording} />
                    <button type="submit" className="send-btn" disabled={(!input.trim() && !selectedFile) || isRecording}>送信</button>
                </form>
            </div>

            {isGroupCreateMode && (
                <div className="group-modal">
                    <div className="group-modal-content">
                        <div className="modal-tabs">
                            <button className={modalMode === 'group' ? 'active' : ''} onClick={() => setModalMode('group')}>グループ作成</button>
                            <button className={modalMode === 'contact' ? 'active' : ''} onClick={() => setModalMode('contact')}>友だち登録</button>
                        </div>
                        {modalMode === 'group' ? (
                            <>
                                <h4>グループ作成</h4>
                                <input type="text" placeholder="グループ名" value={newGroupName} onChange={e => setNewGroupName(e.target.value)} />
                                <div className="member-selection">
                                    {users.filter(u => String(u.id) !== String(user.id)).map(u => (
                                        <label key={u.id} className="member-item">
                                            <input type="checkbox" checked={selectedUserIds.includes(u.id)} onChange={e => e.target.checked ? setSelectedUserIds([...selectedUserIds, u.id]) : setSelectedUserIds(selectedUserIds.filter(id => id !== u.id))} />
                                            <img src={u.avatar_url} alt="" className="avatar-small" />
                                            <span>{u.name}</span>
                                        </label>
                                    ))}
                                </div>
                                <div className="modal-actions">
                                    <button onClick={() => setIsGroupCreateMode(false)}>キャンセル</button>
                                    <button className="primary" onClick={handleCreateGroup}>作成</button>
                                </div>
                            </>
                        ) : (
                            <>
                                <h4>友だち登録</h4>
                                <p className="modal-desc">招待したいGoogleアカウント（Gmail）を入力してください。</p>
                                <input type="email" placeholder="example@gmail.com" value={inviteEmail} onChange={e => setInviteEmail(e.target.value)} />
                                <div className="modal-actions">
                                    <button onClick={() => setIsGroupCreateMode(false)}>キャンセル</button>
                                    <button className="primary" onClick={handleInviteContact}>招待送信</button>
                                </div>
                            </>
                        )}
                    </div>
                </div>
            )}

            {isGroupEditMode && editingGroup && (
                <div className="group-modal">
                    <div className="group-modal-content">
                        <h4>グループ編集</h4>
                        <form onSubmit={handleGroupUpdate}>
                            <div className="group-icon-edit">
                                {groupEditAvatarPreview ? <img src={groupEditAvatarPreview} alt="" className="group-avatar-preview" /> : <div className="group-avatar-preview group-icon">👥</div>}
                                <label className="avatar-input-label">変更<input type="file" accept="image/*" onChange={handleGroupAvatarChange} style={{ display: 'none' }} /></label>
                            </div>
                            <div className="input-group">
                                <label>グループ名</label>
                                <input type="text" placeholder="グループ名" value={groupEditName} onChange={e => setGroupEditName(e.target.value)} required />
                            </div>

                            <div className="member-selection">
                                <label>メンバー編集</label>
                                {users.filter(u => String(u.id) !== String(user.id)).map(u => (
                                    <label key={u.id} className="member-item">
                                        <input
                                            type="checkbox"
                                            checked={editingGroupMembers.includes(u.id)}
                                            onChange={e => {
                                                if (e.target.checked) {
                                                    setEditingGroupMembers([...editingGroupMembers, u.id]);
                                                } else {
                                                    setEditingGroupMembers(editingGroupMembers.filter(id => id !== u.id));
                                                }
                                            }}
                                        />
                                        <img src={u.avatar_url} alt="" className="avatar-small" />
                                        <span>{u.name}</span>
                                    </label>
                                ))}
                                <label className="member-item disabled">
                                    <input type="checkbox" checked disabled />
                                    <img src={user.avatar_url} alt="" className="avatar-small" />
                                    <span>{user.name} (あなた)</span>
                                </label>
                            </div>

                            <div className="danger-zone">
                                {!showDeleteConfirm ? (
                                    <button type="button" className="delete-btn" onClick={generateDeleteCode}>このグループを削除</button>
                                ) : (
                                    <div className="delete-confirm-box">
                                        <p className="delete-warning">確認のため下の文字列を入力してください：</p>
                                        <div className="confirm-code-display">{deleteConfirmCode}</div>
                                        <input
                                            type="text"
                                            className="delete-code-input"
                                            value={userInputDeleteCode}
                                            onChange={e => setUserInputDeleteCode(e.target.value.toUpperCase())}
                                            placeholder="5文字入力"
                                            maxLength={5}
                                        />
                                        <div className="delete-confirm-actions">
                                            <button type="button" className="cancel-delete-btn" onClick={() => setShowDeleteConfirm(false)}>キャンセル</button>
                                            <button type="button" className="final-delete-btn" onClick={handleDeleteGroup} disabled={userInputDeleteCode !== deleteConfirmCode}>削除を実行</button>
                                        </div>
                                    </div>
                                )}
                            </div>

                            <div className="modal-actions">
                                <button type="button" onClick={() => setIsGroupEditMode(false)}>キャンセル</button>
                                <button type="submit" className="primary" disabled={isUpdatingGroup}>{isUpdatingGroup ? '更新中...' : '保存'}</button>
                            </div>
                        </form>
                    </div>
                </div>
            )}

            {modalFile && (
                <div className="image-modal" onClick={() => setModalFile(null)}>
                    <span className="close-modal" onClick={() => setModalFile(null)}>✕</span>
                    <div className="modal-content" onClick={e => e.stopPropagation()}>
                        <img src={modalFile.file_url} alt="full preview" />
                        <div className="modal-actions-bar">
                            <button className="save-btn" onClick={() => handleFileDownload(modalFile.file_url, modalFile.file_name || 'image.jpg')}>💾 保存 / 共有</button>
                        </div>
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
                    </div>
                </div>
            )}
        </div>
    );
};

export default Chat;
