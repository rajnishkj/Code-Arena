import axios from 'axios';

const API = axios.create({
    baseURL: 'http://localhost:8080/api'
});

API.interceptors.request.use(config => {
    const token = localStorage.getItem('token');
    if (token) config.headers.Authorization = `Bearer ${token}`;
    return config;
});

API.interceptors.response.use(
    res => res,
    err => {
        const status = err.response?.status;
        const staleSession = status === 401 && err.config?.url !== '/users/login';
        if (status === 403 || staleSession) {
            localStorage.clear();
            window.location.href = '/login';
        }
        return Promise.reject(err);
    }
);

export default API;
