import { useEffect } from 'react';
import { useToast } from '@chakra-ui/react';
import { Navigate, Outlet } from 'react-router-dom';
import { useRecoilValue, useSetRecoilState } from 'recoil';
import { logined, websocketstate, wsURL } from '../../recoil/atom';

export default function Auth() {
    const isLogined = useRecoilValue(logined);
    const wsurl = useRecoilValue(wsURL);
    const setWebSocket = useSetRecoilState(websocketstate);
    const toast = useToast();

    useEffect(() => {
        if (!isLogined) return;

        let ws: WebSocket;
        let timeout: ReturnType<typeof setTimeout>;
        let retryDelay = 1000;
        let disposed = false;

        const connect = () => {
            ws = new WebSocket(wsurl);
            ws.onopen = () => {
                if (disposed) return;
                retryDelay = 1000;
                setWebSocket(ws);
                toast({
                    title: 'Connected',
                    description: 'Connected to server',
                    status: 'success',
                    duration: 2000,
                    isClosable: true,
                });
            };
            ws.onclose = (event) => {
                if (disposed) return;
                setWebSocket(null);
                // Normal closure includes expired credentials and replacement by another tab.
                if (event.code === 1000) return;
                toast({
                    title: 'Disconnected',
                    description: 'Disconnected from server. Attempting to reconnect...',
                    status: 'error',
                    duration: 2000,
                    isClosable: true,
                });
                timeout = setTimeout(connect, retryDelay);
                retryDelay = Math.min(retryDelay * 2, 30000);
            };
        };

        connect();
        return () => {
            disposed = true;
            clearTimeout(timeout);
            ws.close();
            setWebSocket(null);
        };
    }, [isLogined, wsurl, setWebSocket, toast]);

    if (!isLogined) {
        return <Navigate to="/" />;
    }
    return <Outlet />;
}
