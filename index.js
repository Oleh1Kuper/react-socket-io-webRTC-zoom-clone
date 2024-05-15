const express = require('express');
const { v4: uuidv4 } = require('uuid');
const http = require('http');
const cors = require('cors');
const twilio = require('twilio');

const PORT = process.env.PORT || 8000;
const app = express();
const server = http.createServer(app);

app.use(cors());

const connectedUsers = [];
let rooms = [];

app.get('/api/room-exists/:roomId', (req, res) => {
  const { roomId } = req.params;
  const room = rooms.find(room => room.id === roomId);

  if (!room) {
    return res.send({ isRoomExists: false });
  }

  if (room.connectedUsers.length > 3) {
    return res.send({ isRoomExists: true, full: true })
  }

  return res.send({ isRoomExists: true, full: false })
});

app.get('/api/get-turn-credentials', (req, res) => {
  const client = twilio(process.env.ACCOUNT_SID, process.env.AUTH_TOKEN);

  client.tokens.create().then(token => res.send({ token }));
});

const io = require('socket.io')(server, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST'],
  },
});

io.on('connection', (socket) => {
  console.log('user is connected', socket.id);

  socket.on('create-new-room', (data) => {
    createRoomHandler(data, socket);
  });

  socket.on('join-room', (data) => {
    joinRoomHandler(data, socket);
  });

  socket.on('connection-signal', (data) => {
    signalHandler(data, socket);
  });

  socket.on('disconnect', () => {
    console.log('user is disconnected', socket.id);
    disconnectHandler(socket);
  });

  socket.on('connection-init', (data) => {
    initConnectionHandler(data, socket);
  });

  socket.on('direct-message', (data) => {
    directMessageHandler(data, socket);
  });
});

const createRoomHandler = (data, socket) => {
  const { username, onlyAudio } = data;
  const roomId = uuidv4();
  const newUser = {
    username,
    roomId,
    id: uuidv4(),
    socketId: socket.id,
    onlyAudio,
  };

  connectedUsers.push(newUser);

  const newRoom = {
    id: roomId,
    connectedUsers: [newUser],
  };

  socket.join(roomId);
  rooms.push(newRoom);
  socket.emit('room-id', { roomId });
  socket.emit('room-update', { connectedUsers: newRoom.connectedUsers });
};

const joinRoomHandler = (data, socket) => {
  const { roomId, username, onlyAudio } = data;
  const newUser = {
    username,
    roomId,
    id: uuidv4(),
    socketId: socket.id,
    onlyAudio,
  };

  const room = rooms.find(room => room.id === roomId);

  room.connectedUsers = [...room.connectedUsers, newUser];
  socket.join(roomId);
  connectedUsers.push(newUser);
  
  room.connectedUsers.forEach(user => {
    if (user.socketId !== socket.id) {
      const data = {
        connectedUserSocketId: socket.id,
      };

      io.to(user.socketId).emit('connection-prepare', data);
    }
  });

  io.to(roomId).emit('room-update', { connectedUsers: room.connectedUsers });
};

const disconnectHandler = (socket) => {
  const user = connectedUsers.find(user => user.socketId === socket.id);

  if (user) {
    const room = rooms.find(room => room.id === user.roomId);

    room.connectedUsers = room.connectedUsers.filter(user => user.socketId !== socket.id);
    socket.leave(user.roomId);

    if (room.connectedUsers.length) {
      io.to(room.id).emit('user-disconnected', { socketId: socket.id });

      io.to(room.id).emit('room-update', { connectedUsers: room.connectedUsers });
    } else {
      rooms = rooms.filter(r => r.id !== room.id);
    }
  }
};

const signalHandler = (data, socket) => {
  const { connectedUserSocketId, signal } = data;
  const signalData = { signal, connectedUserSocketId: socket.id };

  io.to(connectedUserSocketId).emit('connection-signal', signalData);
};

const initConnectionHandler = (data, socket) => {
  const { connectedUserSocketId } = data;
  const initData = {
    connectedUserSocketId: socket.id,
  };

  io.to(connectedUserSocketId).emit('connection-init', initData);
};

const directMessageHandler = (data, socket) => {
  const user = connectedUsers
    .find((user) => user.socketId === data.receiverSocketId);

  if (user) {
    const receiverData = {
      authorSocketId: socket.id,
      messageContent: data.messageContent,
      isAuthor: false,
      username: data.username,
    };

    socket.to(data.receiverSocketId).emit('direct-message', receiverData);

    const authorData = {
      receiverSocketId: data.receiverSocketId,
      messageContent: data.messageContent,
      isAuthor: true,
      username: data.username,
    };

    socket.emit('direct-message', authorData);
  }
}

server.listen(PORT, () => {
  console.log(`Server is running on http://localhost:${PORT}`);
});
