import { useEffect, useState } from "react";

export type CustomerLocale = "ru" | "uz";

const copy = {
  ru: {
    start: "Создать заказ",
    catalog: "Услуги",
    orders: "Мои заказы",
    notifications: "Уведомления",
    studios: "Студии",
    hero: "Печать и фотоуслуги — онлайн",
    lead: "Загрузите файл, проверьте макет и узнайте итоговую цену до оплаты. Заказ выполнит подходящая студия AGAT PRINT.",
    choose: "Выберите услугу",
    configure: "Настройте заказ",
    continue: "Продолжить",
    quantity: "Количество",
    file: "Выберите файл PDF, DOCX, JPG или PNG",
    upload: "Загрузить файл",
    processing:
      "Файл обрабатывается. Можно закрыть страницу и вернуться позже.",
    prepare: "Подготовить макет",
    review: "Проверьте макет",
    approve: "Подтвердить макет",
    manual: "Макет ожидает проверки оператором.",
    quality: "Файл не прошёл проверку качества. Выберите другой файл.",
    quote: "Рассчитать цену",
    checkout: "Оформить заказ",
    total: "Итого",
    retry: "Повторить",
    emptyOrders: "У вас пока нет заказов.",
    emptyNotifications: "Новых уведомлений нет.",
    studioChoice: "Выбор студии",
    autoAssign: "Подобрать студию автоматически",
    preferredStudio: "Предпочитаемая студия",
    allowFallback: "Если студия занята, подобрать другую",
    strictPreference: "Только выбранная студия",
    studioSaved: "Выбор студии сохранён.",
  },
  uz: {
    start: "Buyurtma yaratish",
    catalog: "Xizmatlar",
    orders: "Buyurtmalarim",
    notifications: "Bildirishnomalar",
    studios: "Studiyalar",
    hero: "Bosma va foto xizmatlari — onlayn",
    lead: "Faylni yuklang, maketni tekshiring va to‘lovdan oldin yakuniy narxni biling. Buyurtmani mos AGAT PRINT studiyasi bajaradi.",
    choose: "Xizmatni tanlang",
    configure: "Buyurtmani sozlang",
    continue: "Davom etish",
    quantity: "Miqdor",
    file: "PDF, DOCX, JPG yoki PNG faylini tanlang",
    upload: "Faylni yuklash",
    processing:
      "Fayl qayta ishlanmoqda. Sahifani yopib, keyinroq qaytishingiz mumkin.",
    prepare: "Maketni tayyorlash",
    review: "Maketni tekshiring",
    approve: "Maketni tasdiqlash",
    manual: "Maket operator tekshiruvini kutmoqda.",
    quality: "Fayl sifat tekshiruvidan o‘tmadi. Boshqa faylni tanlang.",
    quote: "Narxni hisoblash",
    checkout: "Buyurtmani rasmiylashtirish",
    total: "Jami",
    retry: "Qayta urinish",
    emptyOrders: "Sizda hali buyurtmalar yo‘q.",
    emptyNotifications: "Yangi bildirishnomalar yo‘q.",
    studioChoice: "Studiyani tanlash",
    autoAssign: "Studiyani avtomatik tanlash",
    preferredStudio: "Afzal studiya",
    allowFallback: "Studiya band bo‘lsa, boshqasini tanlash",
    strictPreference: "Faqat tanlangan studiya",
    studioSaved: "Studiya tanlovi saqlandi.",
  },
} as const;

export const customerCopy = (locale: CustomerLocale) => copy[locale];
export const localeFrom = (value: string | null | undefined): CustomerLocale =>
  value === "uz" ? "uz" : "ru";

export function useCustomerLocale() {
  const [locale, setLocale] = useState<CustomerLocale>("ru");
  useEffect(() => {
    setLocale(
      localeFrom(new URLSearchParams(window.location.search).get("lang")),
    );
  }, []);
  return locale;
}

export const customerError = (code: string, locale: CustomerLocale) => {
  const messages: Record<CustomerLocale, Record<string, string>> = {
    ru: {
      FILE_SIZE_EXCEEDED: "Файл слишком большой.",
      SIZE_MISMATCH: "Размер файла изменился во время загрузки.",
      UNSUPPORTED_FILE_EXTENSION: "Этот формат файла не поддерживается.",
      FILE_NOT_ALLOWED_FOR_SERVICE: "Файл не подходит для выбранной услуги.",
      INVALID_SERVICE_OPTIONS: "Проверьте выбранные параметры.",
      MISSING_SERVICE_OPTION: "Заполните обязательные параметры.",
      QUOTE_STALE: "Цена устарела. Рассчитайте её ещё раз.",
      LAYOUT_APPROVAL_NOT_CURRENT:
        "Макет изменился и требует повторного подтверждения.",
      PARTNER_UNAVAILABLE:
        "Сейчас нет доступной студии. Оплата будет безопасно возвращена.",
      STUDIO_NOT_ELIGIBLE: "Эта студия сейчас не подходит для заказа.",
      STUDIO_PREFERENCE_STALE:
        "Данные студии изменились. Выберите студию повторно.",
      DRAFT_VERSION_CONFLICT:
        "Заказ изменился на другом устройстве. Страница обновлена.",
      CONCURRENT_CHANGE: "Запрос уже выполняется. Обновите состояние заказа.",
      REQUEST_FAILED: "Связь прервалась. Попробуйте ещё раз — заказ сохранён.",
      UPLOAD_FAILED:
        "Не удалось загрузить файл. Заказ сохранён, повторите попытку.",
    },
    uz: {
      FILE_SIZE_EXCEEDED: "Fayl juda katta.",
      SIZE_MISMATCH: "Yuklash paytida fayl hajmi o‘zgardi.",
      UNSUPPORTED_FILE_EXTENSION: "Bu fayl formati qo‘llab-quvvatlanmaydi.",
      FILE_NOT_ALLOWED_FOR_SERVICE: "Fayl tanlangan xizmatga mos emas.",
      INVALID_SERVICE_OPTIONS: "Tanlangan parametrlarni tekshiring.",
      MISSING_SERVICE_OPTION: "Majburiy parametrlarni to‘ldiring.",
      QUOTE_STALE: "Narx eskirgan. Uni qayta hisoblang.",
      LAYOUT_APPROVAL_NOT_CURRENT:
        "Maket o‘zgardi va qayta tasdiqlanishi kerak.",
      PARTNER_UNAVAILABLE:
        "Hozir mos studiya yo‘q. To‘lov xavfsiz qaytariladi.",
      STUDIO_NOT_ELIGIBLE: "Bu studiya hozir buyurtmaga mos emas.",
      STUDIO_PREFERENCE_STALE:
        "Studiya ma’lumotlari o‘zgardi. Uni qayta tanlang.",
      DRAFT_VERSION_CONFLICT:
        "Buyurtma boshqa qurilmada o‘zgardi. Sahifa yangilandi.",
      CONCURRENT_CHANGE: "So‘rov bajarilmoqda. Buyurtma holatini yangilang.",
      REQUEST_FAILED:
        "Aloqa uzildi. Qayta urinib ko‘ring — buyurtma saqlangan.",
      UPLOAD_FAILED:
        "Fayl yuklanmadi. Buyurtma saqlangan, qayta urinib ko‘ring.",
    },
  };
  return (
    messages[locale][code] ??
    (locale === "uz"
      ? "Amal bajarilmadi. Qayta urinib ko‘ring."
      : "Не удалось выполнить действие. Попробуйте ещё раз.")
  );
};
