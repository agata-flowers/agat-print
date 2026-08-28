import { IsIn, IsInt, IsString, MaxLength, Min } from "class-validator";

export class CreateUploadSessionDto {
  @IsIn(["pdf", "docx", "jpg", "jpeg", "png"])
  extension!: "pdf" | "docx" | "jpg" | "jpeg" | "png";

  @IsString()
  @MaxLength(100)
  declaredMime!: string;

  @IsInt()
  @Min(1)
  sizeBytes!: number;
}
