import express from 'express';
import { Server } from 'socket.io';
import { createServer } from 'http';
import dotenv from 'dotenv';
import cors from 'cors'; // Importando o pacote cors

import { PrismaClient } from '@prisma/client';

// Initialize Prisma
const prisma = new PrismaClient();

// Load environment variables
dotenv.config();

const app = express();
const server = createServer(app);

// Configuração do CORS para permitir o acesso de qualquer origem
app.use(cors({
    origin: "*", // Permitir todas as origens ou defina uma origem específica
    methods: ["GET", "POST"],
    credentials: true, // Se você precisar enviar cookies ou credenciais
}));

const io = new Server(server, {
    cors: {
        origin: "*", // Permitir todas as origens para o Socket.IO
        methods: ["GET", "POST"],
        credentials: true,
    }
});

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Basic error handling middleware
app.use((err, req, res, next) => {
    console.error(err.stack);
    res.status(500).send('Something broke!');
});

// Socket.IO connection handling
io.on('connection', async (socket) => {
    console.log('A user connected');
    
    try {
        // Get latest messages
        const recentMessages = await prisma.message.findMany({
            take: 10,
            orderBy: {
                createdAt: 'desc'
            },
            include: {
                user: true
            }
        });
        socket.emit('recent-messages', recentMessages);
    } catch (error) {
        console.error('Error fetching recent messages:', error);
    }

    socket.on('disconnect', () => {
        console.log('A user disconnected');
    });
});

app.get("/api/messages", async (req, res) => {
    try {
        const messages = await prisma.message.findMany({
            orderBy: {
                createdAt: 'desc'
            },
            include: {
                user: true
            }
        });
        res.status(200).json({ success: true, data: messages});
    } catch (error) {
        console.error('Error fetching messages:', error);
        res.status(500).json({ success: false, error: 'Internal server error' });
    }
}); 

// API Routes
app.post("/api/contact", async (req, res) => {
    try {
        const { name, subject, email, message } = req.body;

        const user = await prisma.user.upsert({
            where: { email },
            update: { name },
            create: {
                email,
                name,
            },
        });

        const newMessage = await prisma.message.create({
            data: {
                subject: subject,
                content: message,
                userEmail: user.email,
            },
        });

        // Emitir o evento para todos os clientes conectados
        io.emit('new-message', {
            user: user,
            message: newMessage
        });

        res.status(200).json({ 
            success: true, 
            message: 'Message sent successfully',
            data: {message: newMessage, user: user} 
        });
    } catch (error) {
        console.error('Error in contact form:', error);
        res.status(500).json({ 
            success: false, 
            error: 'Internal server error' 
        });
    }
});

// Health check endpoint
app.get('/health', async (req, res) => {
    try {
        // Test database connection
        await prisma.$queryRaw`SELECT 1`;
        res.status(200).json({ 
            status: 'ok', 
            database: 'connected',
            timestamp: new Date().toISOString() 
        });
    } catch (error) {
        res.status(500).json({ 
            status: 'error', 
            database: 'disconnected',
            error: error.message 
        });
    }
});

const PORT = process.env.PORT || 3000;

// Graceful shutdown
process.on('SIGTERM', async () => {
    console.log('SIGTERM received. Closing HTTP server and Prisma client...');
    await prisma.$disconnect();
    server.close(() => {
        console.log('HTTP server closed');
        process.exit(0);
    });
});

server.listen(PORT, '0.0.0.0', () => {
    console.log(`Server is running on port ${PORT}`);
});
