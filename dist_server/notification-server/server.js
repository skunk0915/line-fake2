const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const webpush = require('web-push');
const bodyParser = require('body-parser');
const cors = require('cors');

const app = express();
const server = http.createServer(app);

// Use environment variables or fallback for testing (replace with actual keys later)
const VAPID_PUBLIC_KEY = process.env.VAPID_PUBLIC_KEY || 'YOUR_VAPID_PUBLIC_KEY';
const VAPID_PRIVATE_KEY = process.env.VAPID_PRIVATE_KEY || 'YOUR_VAPID_PRIVATE_KEY';
const EMAIL = process.env.VAPID_EMAIL || 'mailto:example@example.com';

webpush.setVapidDetails(EMAIL, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);

const io = new Server(server, {
  cors: {
    origin: "*", // Allow all origins for simplicity, in production specify your domain
    methods: ["GET", "POST"]
  }
});

app.use(cors());
app.use(bodyParser.json());

// Root endpoint for health check
app.get('/', (req, res) => {
  res.send('Notification Server is running');
});

// Endpoint called by PHP server to broadcast message and send push notifications
app.post('/broadcast', async (req, res) => {
  const { message, subscriptions } = req.body;

  if (!message) {
    return res.status(400).json({ error: 'Message payload required' });
  }

  // 1. WebSocket Broadcast
  io.emit('chat_message', message);
  console.log('Broadcasted message via Socket.io');

  // 2. Web Push Notifications
  if (subscriptions && Array.isArray(subscriptions) && subscriptions.length > 0) {
    console.log(`Sending push to ${subscriptions.length} subscribers`);
    
    const notificationPayload = JSON.stringify({
      title: 'New Message',
      body: message.type === 'image' ? 'Sent an image' : message.content,
      icon: '/icon-192.png',
      badge: '/badge.png',
      data: { url: '/' } // Open root on click
    });

    // Execute concurrently but don't wait for all to respond to the PHP server
    // (In production, maybe queue these)
    Promise.allSettled(subscriptions.map(sub => {
      // sub should contain endpoint and keys, standard Web Push subscription object
      return webpush.sendNotification(sub, notificationPayload)
        .catch(err => {
            if (err.statusCode === 410 || err.statusCode === 404) {
                // Subscription is invalid, should ideally remove from DB
                console.log(`Subscription invalid: ${sub.endpoint}`);
            } else {
                console.error('Push error:', err);
            }
        });
    })).then(results => {
        console.log('Push notifications processed');
    });
  }

  res.status(200).json({ success: true });
});

io.on('connection', (socket) => {
  console.log('A user connected');
  socket.on('disconnect', () => {
    console.log('User disconnected');
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Server listening on port ${PORT}`);
});
