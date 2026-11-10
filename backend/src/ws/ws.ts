import WebSocket from 'ws';
import { IncomingMessage } from 'http';
import * as http from 'http';
import {verifyToken} from '../utils/jwt';
import { JwtPayload } from 'jsonwebtoken';
import {parse} from 'cookie';

export const userSocket = new Map<string, WebSocket>();

export function WS_SERVER(server: http.Server) {
  const wss = new WebSocket.Server({ server });

  wss.on('connection', (ws: WebSocket, req: IncomingMessage) => {
    const cookies = req.headers.cookie;
    
    if (!cookies) {
      ws.send('No token provided');
      ws.close(1000);
      return;
    }
    const parsedCookies = parse(cookies); 
    const token = parsedCookies['token'];
    
    if (!token) {
      ws.send('No  token provided');
      ws.close(1000);
      return;
    }
    let id: JwtPayload;
    try {
      id = verifyToken(token) as JwtPayload;

      const existingSocket = userSocket.get(id.id);
      if(existingSocket){
        existingSocket.close(1000);
      }

      userSocket.set(id.id, ws);
      
    } catch (err) {
      ws.send('Invalid token, Unauthorized');
      ws.close(1000);
      return;
    }
    ws.on('message', (message: WebSocket.Data) => {
      let data;
      try {
        data = JSON.parse(message.toString());
      } catch {
        return;
      }

      if (!data || typeof data.type !== 'string' || typeof data.userId !== 'string') {
        return;
      }
      const { type, userId } = data;

      if (type === 'offer') {
        const socket = userSocket.get(userId); 

        if (socket) {
          socket.send(
            JSON.stringify({ type: 'offer', offer: data.offer, userId: id.id, name: data.name })
          );
        } else {
          ws.send(
            JSON.stringify({ type: 'call-rejected', message: 'User is offline', userId: id.id })
          );
        }
      }

      if (type === 'answer') {
        const socket = userSocket.get(userId);
        if (socket) {
          socket.send(JSON.stringify({ type: 'answer', answer: data.answer, userId: id.id }));
        }
      }

      if (type === 'ICEcandidate') {
        const socket = userSocket.get(userId); 
        if (socket) {
          socket.send(JSON.stringify({ type: 'ICEcandidate', candidate: data.candidate, userId: id.id }));
        }
      }

      if (type === 'call-rejected') {
        const socket = userSocket.get(userId);
        if (socket) {
          socket.send(JSON.stringify({ type: 'call-rejected', userId: id.id }));
        }
      }

      if (type === 'call-ended') {
        const socket = userSocket.get(userId);
        if (socket) {
          socket.send(JSON.stringify({ type: 'call-ended', userId: id.id }));
        }
      }
    });

    ws.on('close', () => {
      if (userSocket.get(id.id) === ws) {
        userSocket.delete(id.id);
      }
    });
  });
}

