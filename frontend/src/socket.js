import { io } from 'socket.io-client';

const URL = import.meta.env.VITE_SERVER_URL || window.location.origin;

export const socket = io(URL, {
  transports: ['websocket', 'polling']
});

export function emitAck(event, payload = {}) {
  return new Promise((resolve) => {
    socket.emit(event, payload, (ack) => {
      resolve(ack);
    });
  });
}
