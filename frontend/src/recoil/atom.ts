import {atom} from 'recoil';

export const logined = atom({
    key:"logined",
    default:false
})

export const user = atom({
    key:"user",
    default:{
        name:"",
        email:"",
        _id:""
    }
})

export const websocketstate = atom<WebSocket|null>({
    key:"websocketstate",
    default:null
})

export const apiURL = atom({
    key:"api",
    default: import.meta.env.VITE_API_URL || (window.location.port === '5173' ? "http://localhost:3000" : "")
})

export const wsURL = atom({
    key:"ws",
    default: import.meta.env.VITE_WS_URL || (window.location.port === '5173' ? "ws://localhost:3000" : (window.location.protocol === 'https:' ? `wss://${window.location.hostname}` : `ws://${window.location.hostname}`))
})