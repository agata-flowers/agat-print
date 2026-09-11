import {
  IsArray,
  IsIn,
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
} from "class-validator";

export class CatalogItemInputDto {
  @IsString()
  @Matches(/^[A-Z][A-Z0-9_]{2,39}$/)
  serviceCode!: string;

  @IsString()
  @Matches(/^[a-z0-9][a-z0-9-]{2,79}$/)
  slug!: string;

  @IsString()
  @MaxLength(120)
  titleRu!: string;

  @IsString()
  @MaxLength(120)
  titleUz!: string;

  @IsString()
  @MaxLength(500)
  descriptionRu!: string;

  @IsString()
  @MaxLength(500)
  descriptionUz!: string;

  @IsArray()
  acceptedFileKinds!: unknown[];

  @IsObject()
  optionSchema!: Record<string, unknown>;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(10_000)
  sortOrder?: number;
}

export class PublishCatalogDto {
  @IsArray()
  items!: CatalogItemInputDto[];
}

export class CreateOrderDraftDto {
  @IsString()
  @Matches(/^[a-z0-9][a-z0-9-]{2,79}$/)
  serviceSlug!: string;

  @IsIn(["ru", "uz"])
  locale!: "ru" | "uz";

  @IsObject()
  configuration!: Record<string, unknown>;

  @IsInt()
  @Min(1)
  @Max(10_000)
  quantity!: number;
}

export class UpdateOrderDraftDto {
  @IsInt()
  @Min(0)
  version!: number;

  @IsObject()
  configuration!: Record<string, unknown>;

  @IsInt()
  @Min(1)
  @Max(10_000)
  quantity!: number;
}

export class LinkDraftResourceDto {
  @IsInt()
  @Min(0)
  version!: number;

  @IsUUID()
  resourceId!: string;
}

export class DraftVersionDto {
  @IsInt()
  @Min(0)
  version!: number;
}

export class FulfillmentPreferenceDto extends DraftVersionDto {
  @IsIn(["PICKUP", "DELIVERY"])
  mode!: "PICKUP" | "DELIVERY";

  @IsString()
  @Matches(/^[A-Z0-9_]{2,40}$/)
  locationCode!: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  address?: string;
}

export class StartDraftUploadDto extends DraftVersionDto {
  @IsIn(["pdf", "docx", "jpg", "jpeg", "png"])
  extension!: "pdf" | "docx" | "jpg" | "jpeg" | "png";

  @IsString()
  @MaxLength(100)
  declaredMime!: string;

  @IsInt()
  @Min(1)
  sizeBytes!: number;
}

export class ReadNotificationDto {
  @IsOptional()
  @IsString()
  marker?: string;
}
