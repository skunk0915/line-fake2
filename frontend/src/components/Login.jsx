import { useGoogleLogin } from '@react-oauth/google';
import axios from 'axios';
import './Login.css';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:8000/api';

const Login = ({ onLogin }) => {
    const login = useGoogleLogin({
        onSuccess: async (tokenResponse) => {
            try {
                // useGoogleLogin returned access_token, not id_token
                const res = await axios.post(`${API_URL}/login.php`, {
                    token: tokenResponse.access_token
                });

                if (res.data && res.data.user) {
                    onLogin(res.data.user);
                }
            } catch (error) {
                console.error('Login Failed:', error);
                alert('Login Failed. Please check console.');
            }
        },
        onError: () => {
            console.log('Login Failed');
        },
    });

    return (
        <div className="login-container">
            <h1>Welcome to Chat App</h1>
            <p>Please login with Google to continue</p>
            <div className="google-btn-wrapper">
                <button className="custom-google-login-btn" onClick={() => login()}>
                    <img src="/line-fake2/favicon/icon-192.png" alt="" className="google-icon-img" />
                    Googleでログイン
                </button>
            </div>
        </div>
    );
};

export default Login;
