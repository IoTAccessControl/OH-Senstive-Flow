
export default class PageResource {
  /**
   * Text of list item.
   */
  title: Resource;
  /**
   * Image of list item.
   */
  img: Resource;
  /**
   * Other resource of list item.
   */
  others?: string | Resource;

  cardPrice?: number | Resource;

  constructor(title: Resource, img: Resource, others?: string | Resource, cardPrice?: number | Resource) {
    this.title = title;
    this.img = img;
    this.others = others;
    this.cardPrice = cardPrice;
  }

  /*constructor(title: Resource, img: Resource, cardId: String) {
    this.title = title;
    this.img = img;
    this.cardId = cardId;
  }
  */

}