import {
  WebSocketGateway,
  SubscribeMessage,
  MessageBody,
  ConnectedSocket,
  OnGatewayConnection,
  OnGatewayDisconnect,
} from '@nestjs/websockets';
import { Injectable, Logger } from '@nestjs/common';
import { Server, Socket } from 'socket.io';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';

interface AuthSocket extends Socket {
  data: {
    userId?: string;
    role?: string;
  };
}

@Injectable()
@WebSocketGateway({
  cors: {
    origin: (process.env.CORS_ORIGINS ?? '*').split(',').map((s) => s.trim()),
    credentials: true,
  },
  transports: ['websocket', 'polling'],
})
export class QueuesGateway implements OnGatewayConnection, OnGatewayDisconnect {
  private readonly logger = new Logger('QueuesGateway');
  io!: Server;

  constructor(
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
  ) {}

  async afterInit(server: Server) {
    this.io = server;

    // Redis adapter for horizontal scaling — optional.
    // If Redis isn't available the gateway still works (single-node only).
    const redisUrl = this.config.get<string>('REDIS_URL');
    if (redisUrl) {
      try {
        const { Redis } = await import('ioredis');
        const { createAdapter } = await import('@socket.io/redis-adapter');
        const pubClient = new Redis(redisUrl, {
          maxRetriesPerRequest: 3,
          enableOfflineQueue: false,
          lazyConnect: true,
        });
        pubClient.on('error', (e) => this.logger.warn(`Redis pub error: ${e.message}`));

        const subClient = pubClient.duplicate();
        subClient.on('error', (e) => this.logger.warn(`Redis sub error: ${e.message}`));

        await pubClient.connect();
        await subClient.connect();

        server.adapter(createAdapter(pubClient, subClient));
        this.logger.log('Socket.io Redis adapter connected');
      } catch (err: any) {
        this.logger.warn(`Socket.io Redis adapter unavailable — running single-node: ${err.message}`);
      }
    }
  }

  async handleConnection(socket: AuthSocket) {
    try {
      const token = socket.handshake.auth?.token;
      if (!token) {
        socket.disconnect();
        return;
      }

      const payload = await this.jwt.verifyAsync(token);
      socket.data.userId = payload.sub;
      socket.data.role = payload.role;
      socket.join(`user:${payload.sub}`);
      this.logger.log(`User ${payload.sub} connected`);
    } catch {
      socket.disconnect();
    }
  }

  handleDisconnect(socket: AuthSocket) {
    this.logger.log(`User ${socket.data.userId} disconnected`);
  }

  @SubscribeMessage('subscribeLocation')
  handleSubscribeLocation(@MessageBody() locationId: string, @ConnectedSocket() socket: AuthSocket) {
    socket.join(`location:${locationId}`);
    this.logger.log(`User ${socket.data.userId} subscribed to location ${locationId}`);
  }

  @SubscribeMessage('unsubscribeLocation')
  handleUnsubscribeLocation(@MessageBody() locationId: string, @ConnectedSocket() socket: AuthSocket) {
    socket.leave(`location:${locationId}`);
    this.logger.log(`User ${socket.data.userId} unsubscribed from location ${locationId}`);
  }

  broadcastLocationUpdate(locationId: string, payload: any): void {
    this.io.to(`location:${locationId}`).emit('locationUpdate', {
      locationId,
      ...payload,
      timestamp: new Date().toISOString(),
    });
  }

  notifyUser(userId: string, payload: any): void {
    this.io.to(`user:${userId}`).emit('notification', {
      ...payload,
      timestamp: new Date().toISOString(),
    });
  }
}
