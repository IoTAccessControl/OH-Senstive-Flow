export class CardInfo {
  id: number = 0;
  cardId: string = '';
  name: string | Resource = ''
  image: Resource | null = null;
  price: number = 0;
  desc: string | Resource = '';
  proper: string | Resource = '';
  size: string | number = '';
  numb: number = 0;

  constructor(id: number = 0, cardId: string, name: string | Resource = '', image: Resource | null = null) {
    this.id = id;
    this.cardId = cardId;
    this.name = name;
    this.image = image;
  }
}

export class ProperColorData {
  id: number = 0;
  cardId: string = '';
  name: string | Resource = ''
  image: Resource | null = null;

  constructor(id: number = 0, cardId: string, name: string | Resource = '', image: Resource | null = null) {
    this.id = id;
    this.cardId = cardId;
    this.name = name;
    this.image = image;
  }
}

export class SimpleCardInfo {
  id: number = 0;
  name: string | Resource = ''
  image: Resource | null = null;

  constructor(id: number = 0, name: string | Resource = '', image: Resource | null = null) {
    this.id = id;
    this.name = name;
    this.image = image;
  }
}