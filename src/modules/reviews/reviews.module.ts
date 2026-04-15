import { Module } from '@nestjs/common';
import { ReviewsController } from './reviews.controller';
import { ReviewsService } from './reviews.service';
import { RatingPromptService } from './rating-prompt.service';
import { AuditModule } from '../../common/audit/audit.module';
import { PushModule } from '../notifications/push/push.module';

@Module({
  imports: [AuditModule, PushModule],
  controllers: [ReviewsController],
  providers: [ReviewsService, RatingPromptService],
  exports: [ReviewsService],
})
export class ReviewsModule {}
