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
import { createAdapter } from '@socket.io/redis-adapter';
import { Redis } from 'ioredis';

interface AuthSocket extends Socket {
  data: {
    userId?: string;
    role?: string;
  };
}

@Injectable()
@WebSocketGateway({
  cors: {
    origin: (process.env.CORS_ORIGINS ?? '').split(',').map((s) => s.trim()),
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
    // Setup Redis adapter for horizontal scaling
    const pubClient = new Redis({
      host: this.config.get('REDIS_HOST') ?? 'localhost',
      port: this.config.get('REDIS_PORT') ?? 6379,
      password: this.config.get('REDIS_PASSWORD'),
    });
    const subClient = pubClient.duplicate();
    server.adapter(createAdapter(pubClient, subClient));
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
      // Auto-join the user's private room so notifyUser() actually reaches them.
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

  /**
   * Public method for services to broadcast location updates.
   */
  broadcastLocationUpdate(locationId: string, payload: any): void {
    this.io.to(`location:${locationId}`).emit('locationUpdate', {
      locationId,
      ...payload,
      timestamp: new Date().toISOString(),
    });
  }

  /**
   * Public method for services to notify a specific user.
   */
  notifyUser(userId: string, payload: any): void {
    this.io.to(`user:${userId}`).emit('notification', {
      ...payload,
      timestamp: new Date().toISOString(),
    });
  }
}
