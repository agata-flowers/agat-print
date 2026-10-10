import { useEffect, useState } from "react";

export type CustomerLocale = "uz" | "ru" | "en";

const copy = {
  ru: {
    start: "Создать заказ",
    catalog: "Услуги",
    orders: "Мои заказы",
    notifications: "Уведомления",
    studios: "Студии",
    partners: "Партнёрам",
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
    basket: "Корзина",
    addToBasket: "Добавить в корзину",
    addAnother: "Добавить ещё услугу",
    basketEmpty: "Корзина пока пуста.",
    removeItem: "Удалить",
    basketQuote: "Рассчитать общую цену",
    basketCheckout: "Оформить один заказ",
    basketPickup: "Самовывоз из студии",
    basketDelivery: "Доставка",
    basketAddress: "Адрес доставки",
  },
  uz: {
    start: "Buyurtma yaratish",
    catalog: "Xizmatlar",
    orders: "Buyurtmalarim",
    notifications: "Bildirishnomalar",
    studios: "Studiyalar",
    partners: "Hamkorlar uchun",
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
    basket: "Savat",
    addToBasket: "Savatga qo‘shish",
    addAnother: "Yana xizmat qo‘shish",
    basketEmpty: "Savat hozircha bo‘sh.",
    removeItem: "Olib tashlash",
    basketQuote: "Umumiy narxni hisoblash",
    basketCheckout: "Bitta buyurtma qilish",
    basketPickup: "Studiyadan olib ketish",
    basketDelivery: "Yetkazib berish",
    basketAddress: "Yetkazib berish manzili",
  },
  en: {
    start: "Create order",
    catalog: "Services",
    orders: "My orders",
    notifications: "Notifications",
    studios: "Studios",
    partners: "For partners",
    hero: "Print and photo services — online",
    lead: "Upload a file, review the layout, and see the final price before payment. An eligible AGAT PRINT studio will fulfil the order.",
    choose: "Choose a service",
    configure: "Configure your order",
    continue: "Continue",
    quantity: "Quantity",
    file: "Choose a PDF, DOCX, JPG, or PNG file",
    upload: "Upload file",
    processing:
      "The file is being processed. You can close this page and return later.",
    prepare: "Prepare layout",
    review: "Review the layout",
    approve: "Approve layout",
    manual: "The layout is waiting for operator review.",
    quality: "The file did not pass the quality check. Choose another file.",
    quote: "Calculate price",
    checkout: "Place order",
    total: "Total",
    retry: "Try again",
    emptyOrders: "You do not have any orders yet.",
    emptyNotifications: "There are no new notifications.",
    studioChoice: "Studio choice",
    autoAssign: "Choose a studio automatically",
    preferredStudio: "Preferred studio",
    allowFallback: "Choose another studio if this one is busy",
    strictPreference: "Only the selected studio",
    studioSaved: "Studio choice saved.",
    basket: "Basket",
    addToBasket: "Add to basket",
    addAnother: "Add another service",
    basketEmpty: "Your basket is empty.",
    removeItem: "Remove",
    basketQuote: "Calculate total",
    basketCheckout: "Place one order",
    basketPickup: "Studio pickup",
    basketDelivery: "Delivery",
    basketAddress: "Delivery address",
  },
} as const;

export const customerCopy = (locale: CustomerLocale) => copy[locale];
export const localeFrom = (value: string | null | undefined): CustomerLocale =>
  value === "uz" || value === "en" ? value : "ru";

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
      FULFILLMENT_SELECTION_REQUIRED: "Выберите способ получения заказа.",
      FULFILLMENT_UNAVAILABLE:
        "Этот способ получения сейчас недоступен. Выберите другой.",
      INVALID_FULFILLMENT_SELECTION:
        "Проверьте способ получения и адрес доставки.",
      FULFILLMENT_SELECTION_IMMUTABLE:
        "Способ получения уже зафиксирован в заказе.",
      DRAFT_VERSION_CONFLICT:
        "Заказ изменился на другом устройстве. Страница обновлена.",
      CONCURRENT_CHANGE: "Запрос уже выполняется. Обновите состояние заказа.",
      BASKET_VERSION_CONFLICT:
        "Корзина изменилась на другом устройстве. Обновите страницу.",
      BASKET_ITEM_LIMIT: "В одной корзине можно добавить не больше 10 позиций.",
      ITEM_NOT_READY: "Сначала подтвердите актуальный макет этой позиции.",
      ITEM_ALREADY_IN_BASKET: "Эта позиция уже находится в активной корзине.",
      PAYMENT_METHOD_UNAVAILABLE: "Этот способ оплаты сейчас недоступен.",
      PAYMENT_ATTEMPT_ACTIVE: "Предыдущая оплата ещё проверяется.",
      PAYMENT_RESULT_UNKNOWN:
        "Результат оплаты уточняется. Не создавайте новый платёж.",
      PAYMENT_PROVIDER_RETRY_SCHEDULED:
        "Провайдер временно недоступен. Проверка продолжится автоматически.",
      STALE_ORDER_VERSION: "Заказ изменился. Обновите страницу перед оплатой.",
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
      FULFILLMENT_SELECTION_REQUIRED: "Buyurtmani olish usulini tanlang.",
      FULFILLMENT_UNAVAILABLE:
        "Bu olish usuli hozir mavjud emas. Boshqasini tanlang.",
      INVALID_FULFILLMENT_SELECTION:
        "Olish usuli va yetkazish manzilini tekshiring.",
      FULFILLMENT_SELECTION_IMMUTABLE:
        "Olish usuli buyurtmada allaqachon saqlangan.",
      DRAFT_VERSION_CONFLICT:
        "Buyurtma boshqa qurilmada o‘zgardi. Sahifa yangilandi.",
      CONCURRENT_CHANGE: "So‘rov bajarilmoqda. Buyurtma holatini yangilang.",
      BASKET_VERSION_CONFLICT:
        "Savat boshqa qurilmada o‘zgardi. Sahifani yangilang.",
      BASKET_ITEM_LIMIT:
        "Bitta savatga ko‘pi bilan 10 ta pozitsiya qo‘shiladi.",
      ITEM_NOT_READY: "Avval ushbu pozitsiyaning amaldagi maketini tasdiqlang.",
      ITEM_ALREADY_IN_BASKET: "Bu pozitsiya faol savatda mavjud.",
      PAYMENT_METHOD_UNAVAILABLE: "Bu to‘lov usuli hozir mavjud emas.",
      PAYMENT_ATTEMPT_ACTIVE: "Oldingi to‘lov hali tekshirilmoqda.",
      PAYMENT_RESULT_UNKNOWN:
        "To‘lov natijasi tekshirilmoqda. Yangi to‘lov yaratmang.",
      PAYMENT_PROVIDER_RETRY_SCHEDULED:
        "Provayder vaqtincha ishlamayapti. Tekshiruv avtomatik davom etadi.",
      STALE_ORDER_VERSION:
        "Buyurtma o‘zgardi. To‘lovdan oldin sahifani yangilang.",
      REQUEST_FAILED:
        "Aloqa uzildi. Qayta urinib ko‘ring — buyurtma saqlangan.",
      UPLOAD_FAILED:
        "Fayl yuklanmadi. Buyurtma saqlangan, qayta urinib ko‘ring.",
    },
    en: {
      FILE_SIZE_EXCEEDED: "The file is too large.",
      SIZE_MISMATCH: "The file size changed during upload.",
      UNSUPPORTED_FILE_EXTENSION: "This file format is not supported.",
      FILE_NOT_ALLOWED_FOR_SERVICE: "The file is not valid for this service.",
      INVALID_SERVICE_OPTIONS: "Check the selected options.",
      MISSING_SERVICE_OPTION: "Complete the required options.",
      QUOTE_STALE: "The quote has expired. Calculate it again.",
      LAYOUT_APPROVAL_NOT_CURRENT:
        "The layout changed and must be approved again.",
      PARTNER_UNAVAILABLE:
        "No studio is currently available. The payment will be refunded safely.",
      STUDIO_NOT_ELIGIBLE:
        "This studio is not currently eligible for the order.",
      STUDIO_PREFERENCE_STALE:
        "The studio details changed. Choose the studio again.",
      FULFILLMENT_SELECTION_REQUIRED: "Choose how you will receive the order.",
      FULFILLMENT_UNAVAILABLE:
        "This fulfilment option is unavailable. Choose another one.",
      INVALID_FULFILLMENT_SELECTION:
        "Check the fulfilment option and delivery address.",
      FULFILLMENT_SELECTION_IMMUTABLE:
        "The fulfilment option is already fixed for this order.",
      DRAFT_VERSION_CONFLICT:
        "The order changed on another device. The page was refreshed.",
      CONCURRENT_CHANGE:
        "The request is already being processed. Refresh the order status.",
      BASKET_VERSION_CONFLICT:
        "The basket changed on another device. Refresh the page.",
      BASKET_ITEM_LIMIT: "A basket can contain at most 10 items.",
      ITEM_NOT_READY: "Approve the current layout for this item first.",
      ITEM_ALREADY_IN_BASKET: "This item is already in an active basket.",
      PAYMENT_METHOD_UNAVAILABLE:
        "This payment method is currently unavailable.",
      PAYMENT_ATTEMPT_ACTIVE: "The previous payment is still being checked.",
      PAYMENT_RESULT_UNKNOWN:
        "The payment result is being checked. Do not create a new payment.",
      PAYMENT_PROVIDER_RETRY_SCHEDULED:
        "The provider is temporarily unavailable. Verification will continue automatically.",
      STALE_ORDER_VERSION:
        "The order changed. Refresh the page before payment.",
      REQUEST_FAILED:
        "The connection was interrupted. Try again — your order is saved.",
      UPLOAD_FAILED:
        "The file could not be uploaded. Your order is saved; try again.",
    },
  };
  return (
    messages[locale][code] ??
    (locale === "uz"
      ? "Amal bajarilmadi. Qayta urinib ko‘ring."
      : locale === "en"
        ? "The action could not be completed. Try again."
        : "Не удалось выполнить действие. Попробуйте ещё раз.")
  );
};
