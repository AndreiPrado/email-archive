/**
 * Returns the current year.
 */
export function getCurrentYear(): number {
  return new Date().getFullYear();
}

/**
 * Returns true if the email should be archived (received before the current year).
 */
export function isBeforeCurrentYear(receivedDateTime: string): boolean {
  return getReceivedYear(receivedDateTime) < getCurrentYear();
}

/**
 * Returns the year in which an email was received.
 */
export function getReceivedYear(receivedDateTime: string): number {
  return new Date(receivedDateTime).getFullYear();
}

/**
 * Returns the destination folder name for a given year.
 * Years <= oldestFolderMaxYear go to "YYYY e anteriores".
 */
export function getDestinationFolderName(year: number, oldestFolderMaxYear: number): string {
  if (year <= oldestFolderMaxYear) {
    return `${oldestFolderMaxYear} e anteriores`;
  }
  return String(year);
}
