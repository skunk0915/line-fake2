import { GoogleLogin } from '@react-oauth/google';
import axios from 'axios';
import './Login.css';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:8000/api';

const Login = ({ onLogin }) => {
    const handleSuccess = async (response) => {
        try {
            const { credential } = response;
            const res = await axios.post(`${API_URL}/login.php`, { token: credential });

            if (res.data && res.data.user) {
                onLogin(res.data.user);
            }
        } catch (error) {
            console.error('Login Failed:', error);
            alert('Login Failed. Please check console.');
        }
    };

    const handleError = () => {
        console.log('Login Failed');
    };

    return (
        <div className="login-container">
            <h1>Welcome to Chat App</h1>
            <p>Please login with Google to continue</p>
            <div className="google-btn-wrapper">
                <GoogleLogin
                    onSuccess={handleSuccess}
                    onError={handleError}
                    auto_select
                />
            </div>
        </div>
    );
};

export default Login;
