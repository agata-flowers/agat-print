import { IsIn, IsOptional, IsString, Length, Matches } from "class-validator";

export class RequestOtpDto {
  @IsString() @Matches(/^\+998[0-9]{9}$/) phone!: string;
}
export class VerifyOtpDto extends RequestOtpDto {
  @IsString() @Length(6, 8) code!: string;
  @IsOptional() @IsIn(["ru", "uz", "en"]) locale?: string;
}
