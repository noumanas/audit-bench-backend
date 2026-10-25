import { IsEmail, IsIn, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';
import { Transform } from 'class-transformer';

// Keys the front-end's contact form sends; labels are what the emails show.
export const CONTACT_TOPICS = {
  support: 'Product support',
  sales: 'Sales and Enterprise plans',
  'due-diligence': 'Technical due diligence',
  security: 'Security disclosure',
  privacy: 'Privacy and data requests',
  partnerships: 'Partnerships and press',
  other: 'Something else',
} as const;
export type ContactTopic = keyof typeof CONTACT_TOPICS;

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);

export class ContactDto {
  @Transform(trim)
  @IsString()
  @MinLength(1, { message: 'Enter your name' })
  @MaxLength(120)
  name!: string;

  @Transform(trim)
  @IsEmail({}, { message: 'Enter a valid email address' })
  @MaxLength(320)
  email!: string;

  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(160)
  company?: string;

  @IsIn(Object.keys(CONTACT_TOPICS))
  topic!: ContactTopic;

  @Transform(trim)
  @IsString()
  @MinLength(10, { message: 'Please write at least a sentence (10 characters)' })
  @MaxLength(5000)
  message!: string;

  // Honeypot: hidden from people by the form, filled in by naive bots.
  @IsOptional()
  @IsString()
  @MaxLength(200)
  website?: string;
}
