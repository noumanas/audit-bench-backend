import { Body, Controller, HttpCode, Post } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { ContactService } from './contact.service';
import { ContactDto } from './contact.dto';

// Public, so tight: 3 messages per 10 minutes per IP. Each one sends a
// confirmation to whatever address was typed in, so this also caps how
// much the form could be used to email someone who didn't ask for it.
const CONTACT_THROTTLE = { default: { limit: 3, ttl: 10 * 60_000 } };

@Controller('contact')
export class ContactController {
  constructor(private readonly contact: ContactService) {}

  @Throttle(CONTACT_THROTTLE)
  @Post()
  @HttpCode(200)
  submit(@Body() dto: ContactDto) {
    return this.contact.submit(dto);
  }
}
