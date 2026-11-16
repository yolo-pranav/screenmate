"use client"
import { useAndroidBackButton } from '@/hooks/useBackButton';

export default function AndroidBackButtonHandler() {
  useAndroidBackButton();
  return null;
}
