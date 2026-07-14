import { Global, Module } from '@nestjs/common';
import { EmailService } from './email.service';
import { MailerService } from './mailer.service';

/** Global: the email seam is infrastructure every feature module may use. */
@Global()
@Module({
  providers: [EmailService, MailerService],
  exports: [EmailService, MailerService],
})
export class EmailModule {}
